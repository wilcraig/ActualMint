<script>
  import { onMount } from 'svelte';
  import { getSettings, saveSettings, checkNow, sendTestMessage, getHistory } from './forecast-api';
  import { getChannels } from './summaries-api';
  import ForecastChart from './ForecastChart.svelte';

  // The Insights page's Forecast tab: which accounts to watch (and each
  // one's warning level), the daily check (channel, time, look-ahead window),
  // Check now, Send test message and the check history. Computing and
  // sending happen in insights-api; this only edits settings and shows the
  // preview. Amounts are integer cents in settings, dollars in the fields.

  let settings = $state(null);
  let savedJson = $state('');
  let accounts = $state([]);
  let timezone = $state(null);
  let channels = $state([]);
  let history = $state([]);
  let loaded = $state(false);
  let loadError = $state(null);

  let saving = $state(false);
  let saveError = $state(null); // { message, field }
  let levelErrors = $state({}); // account id -> message, for unparsable dollar fields
  // What the user typed in each warning-level field. The only thing bound to
  // the input, so typing is never rewritten; cents in settings derive from it.
  let levelText = $state({});

  let checking = $state(false);
  let checkError = $state(null);
  let forecast = $state(null);
  let checkedDays = $state(15);
  // Which account's chart is shown when Check now covered more than one.
  let chartAccountId = $state(null);
  let chartResult = $derived.by(() => {
    const results = (forecast && forecast.results) || [];
    return results.find((r) => r.accountId === chartAccountId) ?? results[0] ?? null;
  });

  let testing = $state(false);
  let testResult = $state(null); // { ok, error }

  let dirty = $derived(settings !== null && JSON.stringify(settings) !== savedJson);
  let savedChannelId = $derived(savedJson ? JSON.parse(savedJson).channelId : null);
  let anyOn = $derived(settings !== null && Object.values(settings.accounts).some((a) => a.enabled));
  let canTest = $derived(settings !== null && !!settings.channelId && settings.channelId === savedChannelId);

  function applyLoaded(next) {
    settings = next;
    savedJson = JSON.stringify(next);
    levelErrors = {};
    levelText = Object.fromEntries(Object.entries(next.accounts || {}).map(([id, a]) => [id, centsToDollars(a.warningLevelCents)]));
  }

  async function refreshHistory() {
    try {
      history = (await getHistory()).history || [];
    } catch {
      // History is informational; a failed refresh keeps the last list.
    }
  }

  async function loadChannels() {
    try {
      channels = (await getChannels()).channels || [];
    } catch {
      // Best-effort: the dropdown still shows the saved channel id.
    }
  }

  async function load() {
    loadError = null;
    try {
      // Reopening the page with unsaved edits keeps them; only the lists refresh.
      if (!dirty) {
        const body = await getSettings();
        if (!body || !body.settings) throw new Error('no settings in the response');
        accounts = body.accounts || [];
        timezone = body.timezone;
        applyLoaded(body.settings);
      }
      await Promise.all([loadChannels(), refreshHistory()]);
    } catch (err) {
      loadError = `Forecast unavailable: ${err.message}`;
    } finally {
      loaded = true;
    }
  }

  onMount(() => {
    load();
    document.addEventListener('insights:page-shown', load);
    return () => document.removeEventListener('insights:page-shown', load);
  });

  function errorFor(field) {
    return saveError && saveError.field === field ? saveError.message : null;
  }

  function toInt(value) {
    const n = Number(value);
    return value !== '' && Number.isFinite(n) ? Math.round(n) : value;
  }

  const centsToDollars = (cents) => (cents / 100).toFixed(2).replace(/\.00$/, '');
  const money = (cents) => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

  function setEnabled(id, on) {
    const existing = settings.accounts[id];
    if (existing) existing.enabled = on;
    else settings.accounts[id] = { enabled: on, warningLevelCents: 0 };
    if (levelText[id] === undefined) levelText[id] = '0';
    if (!on) delete levelErrors[id];
    // Switching back on re-checks the text still in the field, so an
    // invalid value can't hide behind the last valid cents.
    else setLevel(id, levelText[id]);
  }

  function setLevel(id, text) {
    levelText[id] = text;
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n) || n < 0) {
      levelErrors[id] = 'Warning level must be zero or more';
      return;
    }
    delete levelErrors[id];
    settings.accounts[id].warningLevelCents = Math.round(n * 100);
  }

  async function save() {
    saveError = null;
    const bad = Object.keys(levelErrors).find((id) => settings.accounts[id]?.enabled);
    if (bad) {
      saveError = { message: levelErrors[bad], field: null };
      return;
    }
    saving = true;
    try {
      const body = await saveSettings($state.snapshot(settings));
      applyLoaded(body.settings);
    } catch (err) {
      saveError = { message: err.message, field: err.field };
    } finally {
      saving = false;
    }
  }

  async function check() {
    checking = true;
    checkError = null;
    forecast = null;
    try {
      const body = await checkNow();
      const f = body && body.forecast;
      if (!f) throw new Error('no forecast in the response');
      if (f.error) checkError = f.error;
      else {
        forecast = f;
        // Chart the first account that falls short, if any.
        const results = f.results || [];
        chartAccountId = (results.find((r) => r.breach) ?? results[0])?.accountId ?? null;
        checkedDays = savedJson ? JSON.parse(savedJson).windowDays : settings.windowDays;
      }
    } catch (err) {
      checkError = err.message;
    } finally {
      checking = false;
    }
  }

  async function sendTest() {
    testing = true;
    testResult = null;
    try {
      const result = await sendTestMessage();
      testResult = { ok: Boolean(result.ok), error: result.ok ? null : result.error };
    } catch (err) {
      testResult = { ok: false, error: err.message };
    } finally {
      testing = false;
      refreshHistory();
    }
  }

  function channelName(id) {
    return channels.find((c) => c.id === id)?.name;
  }

  // Every run lands in history, sent or not, so say what each one did.
  // Names only when the tab knows every warned account; otherwise a count.
  function historyResult(entry) {
    if (!entry.ok) return `✗ ${entry.error ?? ''}`;
    const warned = entry.warned || [];
    if (warned.length === 0) return 'Nothing to send';
    const names = warned.map((id) => accounts.find((a) => a.id === id)?.name);
    if (names.every(Boolean)) return `Warned: ${names.join(', ')}`;
    return `Warned: ${warned.length} account${warned.length === 1 ? '' : 's'}`;
  }

  function formatWhen(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
  }
</script>

<div class="actualmint-forecast-tab settings-section">
  <div class="section-header">
    <h3 class="section-title">Forecast</h3>
  </div>

  {#if loadError}
    <p class="forecast-error" role="alert">{loadError}</p>
  {:else if !loaded || !settings}
    <p class="forecast-note">Loading forecast…</p>
  {:else}
    <div class="settings-list">
      <p class="forecast-note">
        Projects each watched account's balance forward from its scheduled bills, income and everyday spending, and warns you before it dips below the level you set.
      </p>

      <h4 class="group-label">Accounts</h4>
      {#if accounts.length === 0}
        <p class="forecast-note">No on-budget accounts found.</p>
      {/if}
      {#each accounts as account (account.id)}
        {@const cfg = settings.accounts[account.id]}
        <div class="account-row" data-account-id={account.id}>
          <div class="setting-row">
            <span class="setting-text">
              <span class="setting-label account-name">{account.name}</span>
              <span class="setting-desc account-balance">{account.balanceCents == null ? '—' : money(account.balanceCents)}</span>
            </span>
            <label class="setting-toggle switch">
              <input type="checkbox" class="switch__input account-toggle" aria-label="Watch {account.name}"
                checked={!!cfg?.enabled} onchange={(e) => setEnabled(account.id, e.target.checked)} />
              <span class="switch__track"><span class="switch__thumb"></span></span>
            </label>
          </div>
          {#if cfg?.enabled}
            <label class="form-row" for="forecast-level-{account.id}">
              <span class="setting-desc">Warn me when the balance would drop below ($)</span>
              <input id="forecast-level-{account.id}" class="abt-input narrow warning-level" type="number" min="0" step="0.01"
                value={levelText[account.id] ?? centsToDollars(cfg.warningLevelCents)} oninput={(e) => setLevel(account.id, e.target.value)} />
              {#if levelErrors[account.id]}<span class="field-error" role="alert">{levelErrors[account.id]}</span>{/if}
              {#if errorFor(`accounts.${account.id}.warningLevelCents`)}<span class="field-error" role="alert">{errorFor(`accounts.${account.id}.warningLevelCents`)}</span>{/if}
            </label>
          {/if}
        </div>
      {/each}
      {#if errorFor('accounts')}<span class="field-error" role="alert">{errorFor('accounts')}</span>{/if}

      <h4 class="group-label">Daily check</h4>
      {#if timezone}
        <p class="forecast-note">Runs in the server's time zone: <strong>{timezone}</strong>.</p>
      {/if}
      <div class="setting-row">
        <span class="setting-text">
          <span class="setting-label">Check every day</span>
          <span class="setting-desc">Sends a message only when a watched account would fall short.</span>
        </span>
        <label class="setting-toggle switch">
          <input id="forecast-enabled" type="checkbox" class="switch__input" aria-label="Check every day"
            checked={settings.enabled} onchange={(e) => { settings.enabled = e.target.checked; }} />
          <span class="switch__track"><span class="switch__thumb"></span></span>
        </label>
      </div>
      {#if errorFor('enabled')}<span class="field-error" role="alert">{errorFor('enabled')}</span>{/if}

      <label class="form-row">
        <span class="setting-desc">Channel</span>
        <select id="forecast-channel" class="abt-input channel-select" value={settings.channelId ?? ''}
          onchange={(e) => { settings.channelId = e.target.value || null; }}>
          <option value="">Choose a channel…</option>
          {#each channels as channel (channel.id)}
            <option value={channel.id}>{channel.name}</option>
          {/each}
          {#if settings.channelId && !channelName(settings.channelId)}
            <option value={settings.channelId}>(deleted channel)</option>
          {/if}
        </select>
        {#if errorFor('channelId')}<span class="field-error" role="alert">{errorFor('channelId')}</span>{/if}
      </label>

      <label class="form-row" for="forecast-time">
        <span class="setting-desc">Time</span>
        <input id="forecast-time" class="abt-input time-input" type="time" value={settings.time}
          oninput={(e) => { settings.time = e.target.value; }} />
        {#if errorFor('time')}<span class="field-error" role="alert">{errorFor('time')}</span>{/if}
      </label>

      <label class="form-row" for="forecast-window-days">
        <span class="setting-desc">Look ahead (days, 1 to 30)</span>
        <input id="forecast-window-days" class="abt-input narrow" type="number" min="1" max="30" step="1"
          value={settings.windowDays} oninput={(e) => { settings.windowDays = toInt(e.target.value); }} />
        {#if settings.windowDays > 15}
          <span class="cc-helper-note forecast-note">Card payments beyond what cc-helper has scheduled are not included past 15 days.</span>
        {/if}
        {#if errorFor('windowDays')}<span class="field-error" role="alert">{errorFor('windowDays')}</span>{/if}
      </label>

      <div class="save-bar">
        <button type="button" class="abt-btn save-settings" disabled={saving} onclick={save}>{saving ? 'Saving…' : 'Save'}</button>
        {#if dirty}
          <span class="unsaved-indicator forecast-note">Unsaved changes</span>
        {/if}
        {#if saveError}
          <span class="save-error forecast-error" role="alert">Not saved: {saveError.message}{saveError.field ? ` (${saveError.field})` : ''}</span>
        {/if}
      </div>

      <div class="action-row">
        <button type="button" class="abt-btn check-now" disabled={checking} onclick={check}>{checking ? 'Checking…' : 'Check now'}</button>
        <button type="button" class="abt-btn send-test" disabled={testing || !canTest}
          title={canTest ? '' : settings.channelId ? 'Save your channel first' : 'Choose a channel first'}
          onclick={sendTest}>{testing ? 'Sending…' : 'Send test message'}</button>
        {#if testResult}
          <span class="test-result" class:forecast-error={!testResult.ok} class:test-ok={testResult.ok} role="status">
            {testResult.ok ? 'Sent' : `Failed: ${testResult.error}`}
          </span>
        {/if}
      </div>
      {#if dirty}
        <p class="forecast-note">Check now and the test message use your saved settings.</p>
      {/if}

      <h4 class="group-label">Forecast</h4>
      {#if checkError}
        <p class="check-error forecast-error" role="alert">{checkError}</p>
      {/if}
      {#if forecast}
        {#each forecast.results || [] as result (result.accountId)}
          <div class="forecast-result" data-account-id={result.accountId}>
            <strong class="result-name">{result.accountName}</strong>
            {#if result.breach}
              <p class="result-warning forecast-warning">
                Drops to {money(result.breach.balanceCents)} on {result.breach.date}, {money(result.breach.shortfallCents)} below {money(result.warningLevelCents)}{result.breach.item ? `, after ${result.breach.item.name} (${money(-result.breach.item.amountCents)})` : ''}.
              </p>
            {:else}
              <p class="result-ok forecast-note">No shortfall in the next {checkedDays} days.</p>
            {/if}
            {#if result.lowest}
              <p class="result-lowest forecast-note">Lowest: {money(result.lowest.balanceCents)} on {result.lowest.date}</p>
            {/if}
            {#if result.allowancePerDayCents > 0}
              <p class="result-allowance result-allowance-amount forecast-note">Includes about {money(result.allowancePerDayCents)} a day for everyday spending.</p>
            {/if}
            {#if result.allowanceNote}
              <p class="result-allowance forecast-note">{result.allowanceNote}</p>
            {/if}
          </div>
        {/each}
        {#if (forecast.results || []).length > 1}
          <label class="form-row chart-picker-row">
            <span class="setting-desc">Chart</span>
            <select class="abt-input forecast-account-picker" value={chartResult?.accountId ?? ''}
              onchange={(e) => { chartAccountId = e.target.value; }}>
              {#each forecast.results as result (result.accountId)}
                <option value={result.accountId}>{result.accountName}</option>
              {/each}
            </select>
          </label>
        {/if}
        {#if chartResult}
          <ForecastChart result={chartResult} />
        {/if}
        {#if (forecast.errors || []).length > 0}
          <div class="forecast-errors">
            {#each forecast.errors as e (e.accountId)}
              <p class="forecast-error">{e.accountName}: {e.error}</p>
            {/each}
          </div>
        {/if}
      {:else if !anyOn}
        <p class="empty-state forecast-note">Switch on an account above to see its forecast.</p>
      {:else if !checkError}
        <p class="forecast-note">Press Check now to see the forecast.</p>
      {/if}

      <h4 class="group-label">Check history</h4>
      {#if history.length === 0}
        <p class="forecast-note">No checks yet.</p>
      {:else}
        <table class="history-table">
          <thead>
            <tr><th>When</th><th>Result</th><th>How</th></tr>
          </thead>
          <tbody>
            {#each history as entry, i (i)}
              <tr class="history-row">
                <td>{formatWhen(entry.at)}</td>
                <td class={entry.ok ? 'history-ok' : 'history-fail'}>{historyResult(entry)}</td>
                <td>{entry.trigger}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}
</div>

<style>
  .actualmint-forecast-tab {
    display: flex;
    flex-direction: column;
  }

  .group-label {
    margin: 16px 0 4px;
  }

  .account-row,
  .forecast-result {
    padding: 4px 0 8px;
    border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 4px 0;
  }

  .save-bar,
  .action-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin: 16px 0 8px;
  }

  .narrow {
    width: 110px;
  }

  .time-input {
    width: 110px;
  }

  .forecast-note,
  .result-ok,
  .result-lowest,
  .result-allowance {
    margin: 0;
    font-size: 12px;
    opacity: 0.65;
  }

  .forecast-warning {
    margin: 2px 0;
    font-size: 12px;
    color: #b45309;
  }

  .forecast-error,
  .field-error {
    margin: 0;
    color: #b91c1c;
    font-size: 12px;
  }

  .test-ok,
  .history-ok {
    color: #15803d;
    font-size: 12px;
  }

  .history-fail {
    color: #b91c1c;
  }

  .history-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .history-table th,
  .history-table td {
    text-align: left;
    padding: 4px 6px;
    border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    vertical-align: top;
  }

  /* Same ABT-shaped controls as SummariesTab.svelte. */
  .abt-input,
  .abt-btn {
    height: 30px;
    border-radius: 6.5px;
    border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    background: color-mix(in srgb, currentColor 10%, transparent);
    color: inherit;
    font: inherit;
    font-size: 12px;
    box-sizing: border-box;
  }

  .abt-input {
    padding: 0 8px;
  }

  .abt-btn {
    padding: 0 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .abt-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
