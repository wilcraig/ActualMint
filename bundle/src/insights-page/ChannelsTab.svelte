<script>
  import { onMount } from 'svelte';
  import { listChannels, createChannel, updateChannel, deleteChannel, testChannel } from './channels-api';

  // The Insights page's Channels tab: the app-wide list of places
  // notifications can go. Each type's form is drawn from the field
  // metadata the API serves, so a new channel type needs no change here.
  // Secrets are write-only: the API says only which ones are set, and an
  // edit form leaves them blank, which keeps the stored value.
  let channels = $state([]);
  let types = $state([]);
  let loaded = $state(false);
  let loadError = $state(null);
  let tests = $state({}); // channel id -> { busy, ok, error }

  // null while the form is closed, else { id (null = new), type, name,
  // values, secretsSet, presetNote, saving, error, errorField }.
  let form = $state(null);

  let formType = $derived(form ? types.find((t) => t.type === form.type) : null);

  async function load() {
    loadError = null;
    try {
      const body = await listChannels();
      channels = body.channels || [];
      types = body.types || [];
    } catch (err) {
      loadError = `Channels unavailable: ${err.message}`;
    } finally {
      loaded = true;
    }
  }

  onMount(() => {
    load();
    document.addEventListener('insights:page-shown', load);
    return () => document.removeEventListener('insights:page-shown', load);
  });

  function typeLabel(typeId) {
    return types.find((t) => t.type === typeId)?.label ?? typeId;
  }

  // Starting values for a type: each field's default, headers as no rows.
  function blankValues(type) {
    const values = {};
    for (const field of type.fields) {
      if (field.kind === 'headers') values[field.key] = [];
      else if (field.secret) values[field.key] = '';
      else values[field.key] = field.default ?? '';
    }
    return values;
  }

  function openAdd() {
    const type = types[0];
    if (!type) return;
    form = {
      id: null, type: type.type, name: '', values: blankValues(type),
      secretsSet: [], presetNote: null, saving: false, error: null, errorField: null,
    };
  }

  function openEdit(channel) {
    const type = types.find((t) => t.type === channel.type);
    const values = blankValues(type);
    for (const field of type.fields) {
      if (field.secret && field.kind !== 'headers') continue; // stays blank
      if (field.kind === 'headers') {
        // Names come back, values never do: an empty value on an existing
        // row means "keep what's stored".
        values[field.key] = (channel.config[field.key] || []).map((h) => ({ name: h.name, value: '', existing: true }));
      } else if (channel.config[field.key] !== undefined) {
        values[field.key] = channel.config[field.key];
      }
    }
    form = {
      id: channel.id, type: channel.type, name: channel.name, values,
      secretsSet: channel.secretsSet || [], presetNote: null, saving: false, error: null, errorField: null,
    };
  }

  function closeForm() {
    form = null;
  }

  function changeType(typeId) {
    const type = types.find((t) => t.type === typeId);
    form = { ...form, type: typeId, values: blankValues(type), presetNote: null, error: null, errorField: null };
  }

  function applyPreset(preset) {
    form = { ...form, values: { ...form.values, ...preset.values }, presetNote: preset.note ?? null };
  }

  function setValue(key, value) {
    form.values[key] = value;
  }

  function addHeaderRow(key) {
    form.values[key] = [...form.values[key], { name: '', value: '', existing: false }];
  }

  function removeHeaderRow(key, index) {
    form.values[key] = form.values[key].filter((_, i) => i !== index);
  }

  // The config to send: secrets left blank are omitted (the API keeps the
  // stored value); header rows that already exist and were left without a
  // value go without one, for the same reason.
  function buildConfig() {
    const config = {};
    for (const field of formType.fields) {
      const value = form.values[field.key];
      if (field.kind === 'headers') {
        config[field.key] = value.map((row) =>
          row.existing && row.value === '' ? { name: row.name } : { name: row.name, value: row.value });
      } else if (field.secret) {
        if (value !== '') config[field.key] = value;
      } else if (field.kind === 'number') {
        if (value !== '') config[field.key] = Number(value);
      } else {
        config[field.key] = value;
      }
    }
    return config;
  }

  async function save() {
    form.saving = true;
    form.error = null;
    form.errorField = null;
    try {
      const config = buildConfig();
      if (form.id) await updateChannel(form.id, { name: form.name, config });
      else await createChannel({ name: form.name, type: form.type, config });
      form = null;
      await load();
    } catch (err) {
      form.error = err.message;
      form.errorField = err.field;
      form.saving = false;
    }
  }

  async function sendTest(channel) {
    tests[channel.id] = { busy: true, ok: null, error: null };
    try {
      const result = await testChannel(channel.id);
      tests[channel.id] = { busy: false, ok: result.ok, error: result.error ?? null };
    } catch (err) {
      tests[channel.id] = { busy: false, ok: false, error: err.message };
    }
  }

  async function remove(channel) {
    if (!window.confirm(`Delete the channel "${channel.name}"?`)) return;
    try {
      await deleteChannel(channel.id);
      channels = channels.filter((c) => c.id !== channel.id);
    } catch (err) {
      tests[channel.id] = { busy: false, ok: false, error: `Delete failed: ${err.message}` };
    }
  }

  function inputType(field) {
    if (field.secret) return 'password';
    if (field.kind === 'number') return 'number';
    if (field.kind === 'url') return 'url';
    return 'text';
  }
</script>

<div class="actualmint-channels-tab settings-section">
  <div class="section-header">
    <h3 class="section-title">Channels</h3>
    {#if !form && loaded && !loadError}
      <button type="button" class="abt-btn add-channel-button" onclick={openAdd}>Add channel</button>
    {/if}
  </div>

  <div class="settings-list">
    {#if loadError}
      <p class="channels-error" role="alert">{loadError}</p>
    {:else if !loaded}
      <p class="channels-note">Loading channels…</p>
    {:else}
      {#if channels.length === 0 && !form}
        <p class="channels-note">No channels yet. A channel is a place notifications can go, like ntfy, email, or a webhook.</p>
      {/if}

      <ul class="channel-rows">
        {#each channels as channel (channel.id)}
          <li class="channel-row" data-channel-id={channel.id}>
            <div class="channel-main">
              <span class="channel-name setting-label">{channel.name}</span>
              <span class="channel-type setting-desc">{typeLabel(channel.type)}</span>
            </div>
            <div class="channel-actions">
              <button type="button" class="abt-btn test-button" disabled={tests[channel.id]?.busy} onclick={() => sendTest(channel)}>
                {tests[channel.id]?.busy ? 'Sending…' : 'Send test'}
              </button>
              <button type="button" class="abt-btn edit-button" onclick={() => openEdit(channel)}>Edit</button>
              <button type="button" class="abt-btn delete-button" onclick={() => remove(channel)}>Delete</button>
            </div>
            {#if tests[channel.id] && !tests[channel.id].busy}
              {#if tests[channel.id].ok}
                <p class="test-result test-result--ok" role="status">✓ Test message sent</p>
              {:else}
                <p class="test-result channels-error" role="alert">{tests[channel.id].error}</p>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>

      {#if form && formType}
        <form class="channel-form" onsubmit={(e) => { e.preventDefault(); save(); }}>
          <h4 class="group-label">{form.id ? 'Edit channel' : 'Add channel'}</h4>

          <label class="form-row" for="channel-name">
            <span class="setting-label">Name</span>
            <input id="channel-name" class="abt-input" type="text" value={form.name}
              class:has-error={form.errorField === 'name'}
              oninput={(e) => { form.name = e.target.value; }} />
          </label>

          <label class="form-row" for="channel-type">
            <span class="setting-label">Type</span>
            <select id="channel-type" class="abt-input" value={form.type} disabled={form.id !== null}
              onchange={(e) => changeType(e.target.value)}>
              {#each types as type (type.type)}
                <option value={type.type}>{type.label}</option>
              {/each}
            </select>
          </label>

          {#if formType.presets}
            <div class="form-row preset-row">
              <span class="setting-label">Presets</span>
              <span class="pill-group">
                {#each formType.presets as preset (preset.id)}
                  <button type="button" class="pill preset-button" id="channel-preset-{preset.id}" onclick={() => applyPreset(preset)}>
                    {preset.label}
                  </button>
                {/each}
              </span>
            </div>
            {#if form.presetNote}
              <p class="channels-note preset-note">{form.presetNote}</p>
            {/if}
          {/if}

          {#each formType.fields as field (field.key)}
            {#if field.kind === 'headers'}
              <div class="form-row headers-row">
                <span class="setting-label">{field.label}</span>
                {#each form.values[field.key] as row, index}
                  <span class="header-pair">
                    <input class="abt-input header-name" type="text" placeholder="Name" value={row.name}
                      oninput={(e) => { row.name = e.target.value; }} />
                    <input class="abt-input header-value" type="password" autocomplete="off"
                      placeholder={row.existing ? 'set — leave blank to keep' : 'Value'} value={row.value}
                      oninput={(e) => { row.value = e.target.value; }} />
                    <button type="button" class="abt-btn header-remove" onclick={() => removeHeaderRow(field.key, index)}>Remove</button>
                  </span>
                {/each}
                <button type="button" class="abt-btn header-add" onclick={() => addHeaderRow(field.key)}>Add header</button>
              </div>
            {:else}
              <label class="form-row" for="channel-field-{field.key}">
                <span class="setting-label">{field.label}</span>
                {#if field.kind === 'select'}
                  <select id="channel-field-{field.key}" class="abt-input" value={form.values[field.key]}
                    class:has-error={form.errorField === field.key}
                    onchange={(e) => setValue(field.key, e.target.value)}>
                    {#each field.options as option}
                      <option value={option}>{option}</option>
                    {/each}
                  </select>
                {:else}
                  <input id="channel-field-{field.key}" class="abt-input" type={inputType(field)}
                    autocomplete="off" value={form.values[field.key]}
                    class:has-error={form.errorField === field.key}
                    placeholder={field.secret && form.secretsSet.includes(field.key) ? 'set — leave blank to keep' : ''}
                    oninput={(e) => setValue(field.key, e.target.value)} />
                {/if}
                {#if form.errorField === field.key && form.error}
                  <span class="field-error" role="alert">{form.error}</span>
                {/if}
              </label>
            {/if}
          {/each}

          {#if form.error && !formType.fields.some((f) => f.key === form.errorField)}
            <p class="channels-error" role="alert">{form.error}</p>
          {/if}

          <div class="form-actions">
            <button type="submit" class="abt-btn save-button" disabled={form.saving}>{form.saving ? 'Saving…' : 'Save'}</button>
            <button type="button" class="abt-btn cancel-button" onclick={closeForm}>Cancel</button>
          </div>
        </form>
      {/if}
    {/if}
  </div>
</div>

<style>
  .actualmint-channels-tab {
    display: flex;
    flex-direction: column;
  }

  .actualmint-channels-tab :global(.section-header) {
    justify-content: space-between;
  }

  .channel-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .channel-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 0;
  }

  .channel-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .channel-actions,
  .form-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .channel-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .header-pair {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .channels-note {
    margin: 0;
    font-size: 12px;
    opacity: 0.65;
  }

  .channels-error,
  .field-error {
    margin: 0;
    color: #b91c1c;
    font-size: 12px;
  }

  .test-result {
    flex-basis: 100%;
    margin: 0;
    font-size: 12px;
  }

  .test-result--ok {
    color: #15803d;
  }

  /* Same ABT-shaped controls as GoalsList.svelte (colors derived from the
     inherited text color so every Actual theme works). */
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

  .abt-input.has-error {
    border-color: #b91c1c;
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
