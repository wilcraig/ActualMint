<script>
  import { onMount } from 'svelte';
  import CategoryPicker from './CategoryPicker.svelte';
  import {
    getSettings,
    saveSettings,
    previewSummary,
    sendSummary,
    getHistory,
    getOptions,
    getCategories,
    getChannels,
  } from './summaries-api';

  // The Insights page's Summaries tab: one shared set of sections, the
  // exclusions every section respects, the deliveries (channel, period,
  // schedule) and the failure-alert channel, all saved together with one
  // Save button, plus Preview, Send now and the send history. Sending and
  // scheduling happen in insights-api; this only edits settings.

  const PERIODS = [
    { id: 'yesterday', label: 'Yesterday' },
    { id: 'week', label: 'Week in Review' },
    { id: 'since-last', label: 'New Since Last Summary' },
    { id: 'month-to-date', label: 'Month-to-date, highlighting This Week' },
  ];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const PREVIEW_FORMATS = [
    { id: 'text', label: 'Text' },
    { id: 'markdown', label: 'Markdown' },
    { id: 'html', label: 'HTML' },
    { id: 'json', label: 'JSON' },
  ];
  const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

  let settings = $state(null);
  let savedJson = $state('');
  let sections = $state([]);
  let timezone = $state(null);
  let categories = $state([]);
  let channels = $state([]);
  let payees = $state([]);
  let schedules = $state([]);
  let history = $state([]);
  let loaded = $state(false);
  let loadError = $state(null);

  let saving = $state(false);
  let saveError = $state(null); // { message, field }
  let deliveryStatus = $state({}); // delivery id -> { previewBusy, previewError, sendBusy, sendOk, sendError }
  let preview = $state(null); // { message, format }

  let dirty = $derived(settings !== null && JSON.stringify(settings) !== savedJson);
  let savedIds = $derived(new Set(savedJson ? JSON.parse(savedJson).deliveries.map((d) => d.id) : []));
  let categoryNames = $derived(new Map(categories.map((c) => [c.id, c.name])));

  function applyLoaded(next) {
    settings = next;
    savedJson = JSON.stringify(next);
  }

  async function refreshHistory() {
    try {
      history = (await getHistory()).history || [];
    } catch {
      // History is informational; a failed refresh keeps the last list.
    }
  }

  // Pickers are best-effort: the tab still works (with ids) if one fails.
  async function loadPickers() {
    const [cats, chans, opts] = await Promise.allSettled([getCategories(), getChannels(), getOptions()]);
    if (cats.status === 'fulfilled') categories = cats.value.categories || [];
    if (chans.status === 'fulfilled') channels = chans.value.channels || [];
    if (opts.status === 'fulfilled') {
      payees = opts.value.payees || [];
      schedules = opts.value.schedules || [];
    }
  }

  async function load() {
    loadError = null;
    try {
      // Reopening the page with unsaved edits keeps them; only the lists refresh.
      if (!dirty) {
        const body = await getSettings();
        if (!body || !body.settings) throw new Error('no settings in the response');
        sections = body.sections || [];
        timezone = body.timezone;
        applyLoaded(body.settings);
      }
      await Promise.all([loadPickers(), refreshHistory()]);
    } catch (err) {
      loadError = `Summaries unavailable: ${err.message}`;
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
    return Number.isFinite(n) ? Math.round(n) : value;
  }

  function dollarsToCents(value) {
    const n = Number(value);
    return value === '' || !Number.isFinite(n) ? 0 : Math.round(n * 100);
  }

  const centsToDollars = (cents) => (cents / 100).toFixed(2).replace(/\.00$/, '');

  function overlapNote(ids) {
    const excluded = new Set(settings.exclusions.categoryIds);
    const both = ids.filter((id) => excluded.has(id)).map((id) => categoryNames.get(id) ?? id);
    if (both.length === 0) return null;
    const list = both.join(', ');
    return `${list} ${both.length === 1 ? 'is' : 'are'} also excluded from updates; ${both.length === 1 ? 'it still shows' : 'they still show'} here.`;
  }

  function newId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function addDelivery() {
    settings.deliveries.push({
      id: newId(),
      name: '',
      enabled: true,
      channelId: null,
      period: 'yesterday',
      schedule: { days: [0, 1, 2, 3, 4, 5, 6], times: ['07:00'] },
    });
  }

  function removeDelivery(index) {
    settings.deliveries.splice(index, 1);
  }

  function toggleDay(delivery, day, on) {
    const days = new Set(delivery.schedule.days);
    if (on) days.add(day);
    else days.delete(day);
    delivery.schedule.days = [...days].sort((a, b) => a - b);
  }

  async function save() {
    saving = true;
    saveError = null;
    try {
      const body = await saveSettings($state.snapshot(settings));
      applyLoaded(body.settings);
    } catch (err) {
      saveError = { message: err.message, field: err.field };
    } finally {
      saving = false;
    }
  }

  function status(id) {
    if (!deliveryStatus[id]) deliveryStatus[id] = {};
    return deliveryStatus[id];
  }

  async function openPreview(delivery) {
    const s = status(delivery.id);
    s.previewBusy = true;
    s.previewError = null;
    try {
      const snapshot = $state.snapshot(settings);
      const { message } = await previewSummary({ delivery: $state.snapshot(delivery), settings: snapshot });
      preview = { message, format: 'text' };
    } catch (err) {
      s.previewError = err.field ? `${err.message} (${err.field})` : err.message;
    } finally {
      s.previewBusy = false;
    }
  }

  function previewBody(p) {
    if (p.format === 'json') return JSON.stringify(p.message.data, null, 2);
    return p.message[p.format] ?? '';
  }

  async function sendNow(delivery) {
    const s = status(delivery.id);
    s.sendBusy = true;
    s.sendOk = null;
    s.sendError = null;
    try {
      const result = await sendSummary(delivery.id);
      s.sendOk = result.ok;
      s.sendError = result.ok ? null : result.error;
    } catch (err) {
      s.sendOk = false;
      s.sendError = err.message;
    } finally {
      s.sendBusy = false;
      refreshHistory();
    }
  }

  function channelName(id) {
    return channels.find((c) => c.id === id)?.name;
  }

  function formatWhen(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
  }
</script>

<div class="actualmint-summaries-tab settings-section">
  <div class="section-header">
    <h3 class="section-title">Summaries</h3>
  </div>

  {#if loadError}
    <p class="summaries-error" role="alert">{loadError}</p>
  {:else if !loaded || !settings}
    <p class="summaries-note">Loading summaries…</p>
  {:else}
    <div class="settings-list">
      <p class="timezone summaries-note">
        Schedules run in the server's time zone: <strong>{timezone ?? 'not set'}</strong>.
      </p>
      {#if timezone && timezone !== BROWSER_TZ}
        <p class="timezone-warning summaries-warning" role="status">
          Your browser is in {BROWSER_TZ}, so times below are {timezone} times, not yours.
        </p>
      {/if}

      <h4 class="group-label">Sections</h4>
      <p class="summaries-note">Every delivery gets the same sections. A section with nothing to report is left out.</p>

      {#each sections as section (section.id)}
        {@const cfg = settings.sections[section.id]}
        {#if cfg}
          <div class="summary-section" data-section-id={section.id} class:summary-section--off={!cfg.enabled}>
            <div class="setting-row">
              <span class="setting-text">
                <span class="setting-label section-name">{section.title}</span>
              </span>
              <label class="setting-toggle switch">
                <input type="checkbox" class="switch__input section-toggle" aria-label="Include {section.title}"
                  checked={cfg.enabled} onchange={(e) => { cfg.enabled = e.target.checked; }} />
                <span class="switch__track"><span class="switch__thumb"></span></span>
              </label>
            </div>

            <div class="section-settings">
              {#if section.id === 'pacing'}
                <label class="form-row" for="summary-pacing-tolerance">
                  <span class="setting-desc">Off track when spending is this many percent past pace</span>
                  <input id="summary-pacing-tolerance" class="abt-input narrow" type="number" min="0" max="100" step="1"
                    value={cfg.tolerancePct} oninput={(e) => { cfg.tolerancePct = toInt(e.target.value); }} />
                  {#if errorFor('sections.pacing.tolerancePct')}<span class="field-error" role="alert">{errorFor('sections.pacing.tolerancePct')}</span>{/if}
                </label>
                <div class="form-row">
                  <span class="setting-desc">Only these categories (none picked = every expense category)</span>
                  <CategoryPicker id="summary-pacing-categories" items={categories} selected={cfg.categoryIds}
                    placeholder="Add a category…" onchange={(ids) => { cfg.categoryIds = ids; }} />
                </div>
              {:else if section.id === 'largest'}
                <label class="form-row" for="summary-largest-count">
                  <span class="setting-desc">How many</span>
                  <input id="summary-largest-count" class="abt-input narrow" type="number" min="1" max="25" step="1"
                    value={cfg.count} oninput={(e) => { cfg.count = toInt(e.target.value); }} />
                  {#if errorFor('sections.largest.count')}<span class="field-error" role="alert">{errorFor('sections.largest.count')}</span>{/if}
                </label>
                <label class="form-row" for="summary-largest-min">
                  <span class="setting-desc">Minimum amount ($)</span>
                  <input id="summary-largest-min" class="abt-input narrow" type="number" min="0" step="0.01"
                    value={centsToDollars(cfg.minAmountCents)} oninput={(e) => { cfg.minAmountCents = dollarsToCents(e.target.value); }} />
                </label>
                <div class="setting-row">
                  <span class="setting-text">
                    <span class="setting-label">Exclude scheduled payments</span>
                    <span class="setting-desc">Anything matched to a schedule is expected, so it never crowds out surprises.</span>
                  </span>
                  <label class="setting-toggle switch">
                    <input id="summary-largest-exclude-scheduled" type="checkbox" class="switch__input"
                      checked={cfg.excludeScheduled} onchange={(e) => { cfg.excludeScheduled = e.target.checked; }} />
                    <span class="switch__track"><span class="switch__thumb"></span></span>
                  </label>
                </div>
              {:else if section.id === 'upcoming'}
                <label class="form-row" for="summary-upcoming-days">
                  <span class="setting-desc">Look ahead (days)</span>
                  <input id="summary-upcoming-days" class="abt-input narrow" type="number" min="1" max="60" step="1"
                    value={cfg.lookAheadDays} oninput={(e) => { cfg.lookAheadDays = toInt(e.target.value); }} />
                  {#if errorFor('sections.upcoming.lookAheadDays')}<span class="field-error" role="alert">{errorFor('sections.upcoming.lookAheadDays')}</span>{/if}
                </label>
                <label class="form-row" for="summary-upcoming-min">
                  <span class="setting-desc">Minimum amount ($)</span>
                  <input id="summary-upcoming-min" class="abt-input narrow" type="number" min="0" step="0.01"
                    value={centsToDollars(cfg.minAmountCents)} oninput={(e) => { cfg.minAmountCents = dollarsToCents(e.target.value); }} />
                </label>
              {:else if section.id === 'watched' || section.id === 'alerts'}
                <div class="form-row">
                  <span class="setting-desc">
                    {section.id === 'watched' ? 'Always shown, good or bad' : 'Shown only when over budget'}
                  </span>
                  <CategoryPicker id="summary-{section.id}-categories" items={categories} selected={cfg.categoryIds}
                    placeholder="Add a category…" onchange={(ids) => { cfg.categoryIds = ids; }} />
                  {#if overlapNote(cfg.categoryIds)}
                    <p class="overlap-note summaries-note">{overlapNote(cfg.categoryIds)}</p>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {/each}

      <h4 class="group-label">Exclude from updates</h4>
      <p class="summaries-note">Excluded categories, payees and schedules vanish from every section (watched and alert categories still show).</p>
      <div class="form-row">
        <span class="setting-desc">Categories</span>
        <CategoryPicker id="summary-exclude-categories" items={categories} selected={settings.exclusions.categoryIds}
          placeholder="Exclude a category…" onchange={(ids) => { settings.exclusions.categoryIds = ids; }} />
      </div>
      <div class="form-row">
        <span class="setting-desc">Payees</span>
        <CategoryPicker id="summary-exclude-payees" items={payees} selected={settings.exclusions.payeeIds}
          placeholder="Exclude a payee…" onchange={(ids) => { settings.exclusions.payeeIds = ids; }} />
      </div>
      <div class="form-row">
        <span class="setting-desc">Schedules</span>
        <CategoryPicker id="summary-exclude-schedules" items={schedules} selected={settings.exclusions.scheduleIds}
          placeholder="Exclude a schedule…" onchange={(ids) => { settings.exclusions.scheduleIds = ids; }} />
      </div>

      <div class="group-header">
        <h4 class="group-label">Deliveries</h4>
        <button type="button" class="abt-btn add-delivery" onclick={addDelivery}>Add delivery</button>
      </div>
      {#if settings.deliveries.length === 0}
        <p class="summaries-note">No deliveries yet. A delivery sends the summary to a channel on a schedule, or when you press Send now.</p>
      {/if}
      {#if channels.length === 0}
        <p class="summaries-note">Add a channel on the Channels tab first; deliveries send through one.</p>
      {/if}

      {#each settings.deliveries as delivery, index (delivery.id)}
        {@const s = deliveryStatus[delivery.id] || {}}
        <div class="delivery-card" data-delivery-id={delivery.id}>
          <div class="delivery-head">
            <input class="abt-input delivery-name" type="text" placeholder="Delivery name" aria-label="Delivery name"
              value={delivery.name} oninput={(e) => { delivery.name = e.target.value; }} />
            <label class="setting-toggle switch" title="Enabled">
              <input type="checkbox" class="switch__input delivery-enabled" aria-label="Enabled"
                checked={delivery.enabled} onchange={(e) => { delivery.enabled = e.target.checked; }} />
              <span class="switch__track"><span class="switch__thumb"></span></span>
            </label>
          </div>
          {#if errorFor(`deliveries[${index}].name`)}<span class="field-error" role="alert">{errorFor(`deliveries[${index}].name`)}</span>{/if}

          <label class="form-row">
            <span class="setting-desc">Channel</span>
            <select class="abt-input channel-select" value={delivery.channelId ?? ''}
              onchange={(e) => { delivery.channelId = e.target.value || null; }}>
              <option value="">Choose a channel…</option>
              {#each channels as channel (channel.id)}
                <option value={channel.id}>{channel.name}</option>
              {/each}
              {#if delivery.channelId && !channelName(delivery.channelId)}
                <option value={delivery.channelId}>(deleted channel)</option>
              {/if}
            </select>
            {#if errorFor(`deliveries[${index}].channelId`)}<span class="field-error" role="alert">{errorFor(`deliveries[${index}].channelId`)}</span>{/if}
          </label>

          <div class="form-row">
            <span class="setting-desc">Period</span>
            <span class="pill-group period-group" role="group" aria-label="Period">
              {#each PERIODS as period (period.id)}
                <button type="button" class="pill" class:pill--active={delivery.period === period.id}
                  aria-pressed={delivery.period === period.id ? 'true' : 'false'}
                  onclick={() => { delivery.period = period.id; }}>{period.label}</button>
              {/each}
            </span>
          </div>

          <div class="form-row">
            <span class="setting-desc">Days</span>
            <span class="day-group">
              {#each DAYS as dayLabel, day (day)}
                <label class="day-label">
                  <input type="checkbox" class="day-checkbox" data-day={day} checked={delivery.schedule.days.includes(day)}
                    onchange={(e) => toggleDay(delivery, day, e.target.checked)} />
                  {dayLabel}
                </label>
              {/each}
            </span>
            {#if errorFor(`deliveries[${index}].schedule.days`)}<span class="field-error" role="alert">{errorFor(`deliveries[${index}].schedule.days`)}</span>{/if}
          </div>

          <div class="form-row">
            <span class="setting-desc">Times {delivery.schedule.times.length === 0 ? '(none: send on demand only)' : ''}</span>
            <span class="time-group">
              {#each delivery.schedule.times as time, timeIndex}
                <span class="time-pair">
                  <input class="abt-input time-input" type="time" value={time} aria-label="Send time"
                    oninput={(e) => { delivery.schedule.times[timeIndex] = e.target.value; }} />
                  <button type="button" class="abt-btn remove-time" aria-label="Remove time"
                    onclick={() => { delivery.schedule.times.splice(timeIndex, 1); }}>×</button>
                </span>
              {/each}
              <button type="button" class="abt-btn add-time" onclick={() => { delivery.schedule.times.push('12:00'); }}>Add time</button>
            </span>
            {#if errorFor(`deliveries[${index}].schedule.times`)}<span class="field-error" role="alert">{errorFor(`deliveries[${index}].schedule.times`)}</span>{/if}
          </div>

          <div class="delivery-actions">
            <button type="button" class="abt-btn preview-button" disabled={s.previewBusy} onclick={() => openPreview(delivery)}>
              {s.previewBusy ? 'Building…' : 'Preview'}
            </button>
            <button type="button" class="abt-btn send-button"
              disabled={s.sendBusy || dirty || !savedIds.has(delivery.id)}
              title={dirty || !savedIds.has(delivery.id) ? 'Save your changes first' : ''}
              onclick={() => sendNow(delivery)}>
              {s.sendBusy ? 'Sending…' : 'Send now'}
            </button>
            <button type="button" class="abt-btn remove-delivery" onclick={() => removeDelivery(index)}>Remove</button>
          </div>
          {#if s.previewError}
            <p class="summaries-error preview-error" role="alert">{s.previewError}</p>
          {/if}
          {#if !s.sendBusy && s.sendOk === true}
            <p class="send-result send-result--ok" role="status">✓ Sent</p>
          {:else if !s.sendBusy && s.sendOk === false}
            <p class="send-result summaries-error" role="alert">✗ {s.sendError}</p>
          {/if}
        </div>
      {/each}
      {#if errorFor('deliveries')}<span class="field-error" role="alert">{errorFor('deliveries')}</span>{/if}

      <h4 class="group-label">Alert me about failures on</h4>
      <label class="form-row" for="summary-failure-channel">
        <span class="setting-desc">After two retries, one alert names the delivery and the error.</span>
        <select id="summary-failure-channel" class="abt-input" value={settings.failureChannelId ?? ''}
          onchange={(e) => { settings.failureChannelId = e.target.value || null; }}>
          <option value="">Nowhere (history only)</option>
          {#each channels as channel (channel.id)}
            <option value={channel.id}>{channel.name}</option>
          {/each}
          {#if settings.failureChannelId && !channelName(settings.failureChannelId)}
            <option value={settings.failureChannelId}>(deleted channel)</option>
          {/if}
        </select>
        {#if errorFor('failureChannelId')}<span class="field-error" role="alert">{errorFor('failureChannelId')}</span>{/if}
      </label>

      <div class="save-bar">
        <button type="button" class="abt-btn save-settings" disabled={saving} onclick={save}>{saving ? 'Saving…' : 'Save'}</button>
        {#if dirty}
          <span class="unsaved-indicator summaries-note">Unsaved changes</span>
        {/if}
        {#if saveError}
          <span class="save-error summaries-error" role="alert">Not saved: {saveError.message}{saveError.field ? ` (${saveError.field})` : ''}</span>
        {/if}
      </div>

      <h4 class="group-label">Send history</h4>
      {#if history.length === 0}
        <p class="summaries-note">Nothing sent yet.</p>
      {:else}
        <table class="history-table">
          <thead>
            <tr><th>When</th><th>Delivery</th><th>Result</th><th>How</th></tr>
          </thead>
          <tbody>
            {#each history as entry, i (i)}
              <tr class="history-row">
                <td>{formatWhen(entry.at)}</td>
                <td>{entry.deliveryName}</td>
                <td class={entry.ok ? 'history-ok' : 'history-fail'}>{entry.ok ? '✓' : `✗ ${entry.error ?? ''}`}</td>
                <td>{entry.trigger}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}

  {#if preview}
    <div class="preview-backdrop" onclick={() => { preview = null; }} role="presentation"></div>
    <div class="preview-dialog" role="dialog" aria-modal="true" aria-label="Summary preview">
      <div class="preview-head">
        <strong class="preview-title">{preview.message.title}</strong>
        <button type="button" class="abt-btn preview-close" onclick={() => { preview = null; }}>Close</button>
      </div>
      <span class="pill-group">
        {#each PREVIEW_FORMATS as format (format.id)}
          <button type="button" class="pill preview-format-{format.id}" class:pill--active={preview.format === format.id}
            aria-pressed={preview.format === format.id ? 'true' : 'false'}
            onclick={() => { preview.format = format.id; }}>{format.label}</button>
        {/each}
      </span>
      <pre class="preview-body">{previewBody(preview)}</pre>
    </div>
  {/if}
</div>

<style>
  .actualmint-summaries-tab {
    display: flex;
    flex-direction: column;
  }

  .group-label {
    margin: 16px 0 4px;
  }

  .group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .summary-section {
    padding: 4px 0 8px;
    border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
  }

  .summary-section--off .section-settings {
    opacity: 0.55;
  }

  .section-settings {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 4px 0;
  }

  .delivery-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 8px 0;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  }

  .delivery-head,
  .delivery-actions,
  .save-bar,
  .time-group,
  .time-pair,
  .day-group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .delivery-head {
    justify-content: space-between;
  }

  .delivery-name {
    flex: 1;
    min-width: 0;
  }

  .day-label {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
  }

  .save-bar {
    margin: 16px 0 8px;
  }

  .narrow {
    width: 110px;
  }

  .summaries-note {
    margin: 0;
    font-size: 12px;
    opacity: 0.65;
  }

  .summaries-warning {
    margin: 0;
    font-size: 12px;
    color: #b45309;
  }

  .summaries-error,
  .field-error {
    margin: 0;
    color: #b91c1c;
    font-size: 12px;
  }

  .send-result {
    margin: 0;
    font-size: 12px;
  }

  .send-result--ok,
  .history-ok {
    color: #15803d;
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

  .preview-backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.35);
    z-index: 100;
  }

  .preview-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(720px, calc(100vw - 32px));
    max-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border-radius: 10px;
    background: Canvas;
    color: CanvasText;
    box-shadow: 0 10px 40px rgb(0 0 0 / 0.3);
    z-index: 101;
  }

  .preview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .preview-body {
    margin: 0;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 12px;
    padding: 10px;
    border-radius: 6px;
    background: color-mix(in srgb, currentColor 6%, transparent);
  }

  /* Same ABT-shaped controls as ChannelsTab.svelte (colors derived from
     the inherited text color so every Actual theme works). */
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
