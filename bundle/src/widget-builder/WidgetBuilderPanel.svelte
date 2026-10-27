<script>
  import { onMount, tick } from 'svelte';
  import { isReportsPath, watchRoute } from './route-watcher';
  import { buildPlaceholder } from './placeholder';
  import { copyText } from './clipboard';
  import { WIDGET_REGISTRY } from './registry';
  import { describePickerError } from './picker-error';
  import { fetchApi } from '../api-client';

  let visible = $state(false);
  let open = $state(false);
  let selectedWidgetId = $state(WIDGET_REGISTRY[0]?.id ?? '');
  let values = $state({});
  let pickerData = $state({});
  let pickerErrors = $state({});
  let filterText = $state({});
  let generatedText = $state('');
  let copyStatus = $state('');
  let generatedTextarea = $state(null);

  let selectedWidget = $derived(
    WIDGET_REGISTRY.find((widget) => widget.id === selectedWidgetId) ?? null,
  );

  onMount(() => {
    const unwatch = watchRoute(window, (pathname) => {
      visible = isReportsPath(pathname);
      if (!visible) open = false;
    });

    if (selectedWidgetId) {
      selectWidget(selectedWidgetId);
    }

    return unwatch;
  });

  function isPickerField(field) {
    return field.type === 'category-multiselect' || field.type === 'account-multiselect';
  }

  async function loadPickerData(field) {
    pickerErrors = { ...pickerErrors, [field.key]: null };
    pickerData = { ...pickerData, [field.key]: null };

    const path = field.type === 'category-multiselect' ? '/api/categories' : '/api/accounts';
    const responseKey = field.type === 'category-multiselect' ? 'categories' : 'accounts';

    let response = null;
    try {
      response = await fetchApi(path);
      const error = describePickerError(response);
      if (error) {
        pickerErrors = { ...pickerErrors, [field.key]: error };
        return;
      }
      const data = await response.json();
      const list = data[responseKey];
      if (!Array.isArray(list)) {
        // Malformed response body (200 but no usable array) - treat it the
        // same as a non-ok response so the UI shows an error instead of
        // sitting on "Loading…" forever.
        pickerErrors = {
          ...pickerErrors,
          [field.key]: describePickerError({ ok: false, status: response.status }),
        };
        return;
      }
      pickerData = { ...pickerData, [field.key]: list };
    } catch {
      pickerErrors = { ...pickerErrors, [field.key]: describePickerError(null) };
    }
  }

  // Refetches a field's picker data if it previously failed, or hasn't
  // loaded yet. Skips fields that already have data so reopening the panel
  // doesn't needlessly re-fetch everything.
  function refreshPickerDataIfNeeded() {
    if (!selectedWidget) return;
    for (const field of selectedWidget.fields) {
      if (!isPickerField(field)) continue;
      const hasData = Array.isArray(pickerData[field.key]);
      const hasError = Boolean(pickerErrors[field.key]);
      if (!hasData || hasError) {
        loadPickerData(field);
      }
    }
  }

  function selectWidget(widgetId) {
    selectedWidgetId = widgetId;
    values = {};
    filterText = {};
    generatedText = '';
    copyStatus = '';

    const widget = WIDGET_REGISTRY.find((w) => w.id === widgetId);
    if (!widget) return;

    for (const field of widget.fields) {
      if (isPickerField(field)) {
        values[field.key] = [];
        loadPickerData(field);
      }
    }
  }

  function toggleOpen() {
    open = !open;
    if (open) {
      refreshPickerDataIfNeeded();
    }
  }

  function toggleOption(fieldKey, optionId) {
    const current = values[fieldKey] ?? [];
    values[fieldKey] = current.includes(optionId)
      ? current.filter((id) => id !== optionId)
      : [...current, optionId];
  }

  function filteredOptions(field) {
    const options = pickerData[field.key] ?? [];
    const query = (filterText[field.key] ?? '').trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => {
      const name = (option.name ?? '').toLowerCase();
      const groupName = (option.groupName ?? '').toLowerCase();
      return name.includes(query) || groupName.includes(query);
    });
  }

  // A widget with fields can't be generated with nothing selected for any
  // of them - that's the empty-placeholder pain point this feature exists
  // to prevent. A widget with no fields has nothing to select, so it's
  // always generatable.
  let canGenerate = $derived(
    selectedWidget
      ? selectedWidget.fields.length === 0
        || selectedWidget.fields.every((field) => (values[field.key] ?? []).length > 0)
      : false,
  );

  async function handleGenerate() {
    if (!selectedWidget || !canGenerate) return;
    generatedText = buildPlaceholder(selectedWidget.id, selectedWidget.fields, values);
    copyStatus = '';
    // Select the textarea's contents immediately so Ctrl/Cmd+C works as a
    // fallback alongside the Copy button, without requiring a manual click.
    // Wait a tick so the textarea's value has actually been updated to the
    // newly generated text before selecting it.
    await tick();
    generatedTextarea?.select();
  }

  async function handleCopy() {
    const ok = await copyText(generatedText);
    copyStatus = ok ? 'Copied' : 'Copy failed — select the text above';
  }
</script>

{#if visible}
  <div class="actualmint-widget-builder">
    <button type="button" class="actualmint-wb-toggle" onclick={toggleOpen}>
      {open ? 'Close widget builder' : 'Widget builder'}
    </button>

    {#if open}
      <div class="actualmint-wb-panel">
        <label class="actualmint-wb-field">
          Widget
          <select
            value={selectedWidgetId}
            onchange={(e) => selectWidget(e.target.value)}
          >
            {#each WIDGET_REGISTRY as widget (widget.id)}
              <option value={widget.id}>{widget.label}</option>
            {/each}
          </select>
        </label>

        {#if selectedWidget}
          {#each selectedWidget.fields as field (field.key)}
            <div class="actualmint-wb-field">
              <span class="actualmint-wb-field-label">{field.label}</span>
              {#if pickerErrors[field.key]}
                <p class="actualmint-wb-error" role="alert">{pickerErrors[field.key]}</p>
              {:else if pickerData[field.key] === null || pickerData[field.key] === undefined}
                <p class="actualmint-wb-loading">Loading…</p>
              {:else}
                <input
                  type="text"
                  class="actualmint-wb-filter"
                  placeholder="Filter…"
                  value={filterText[field.key] ?? ''}
                  oninput={(e) => { filterText = { ...filterText, [field.key]: e.target.value }; }}
                />
                <ul class="actualmint-wb-options">
                  {#each filteredOptions(field) as option (option.id)}
                    <li>
                      <label>
                        <input
                          type="checkbox"
                          checked={(values[field.key] ?? []).includes(option.id)}
                          onchange={() => toggleOption(field.key, option.id)}
                        />
                        {option.name}{option.groupName ? ` (${option.groupName})` : ''}
                      </label>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/each}
        {/if}

        <button
          type="button"
          class="actualmint-wb-generate"
          onclick={handleGenerate}
          disabled={!canGenerate}
        >
          Generate
        </button>

        <div class="actualmint-wb-output">
          <!--
            The generated placeholder must stay inside a form control's
            `.value` (never rendered as plain text content): mount.js scans
            the whole document.body for placeholder-shaped text nodes, so
            showing this string as visible text would make the panel's own
            output get mistakenly picked up and mounted as a live widget.
          -->
          <textarea
            class="actualmint-wb-textarea"
            readonly
            value={generatedText}
            bind:this={generatedTextarea}
            onclick={(e) => e.target.select()}
          ></textarea>
          <button type="button" class="actualmint-wb-copy" onclick={handleCopy} disabled={!generatedText}>
            Copy
          </button>
          {#if copyStatus}
            <span class="actualmint-wb-copy-status">{copyStatus}</span>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .actualmint-widget-builder {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    z-index: 9999;
    font-family: inherit;
    font-size: 0.9rem;
  }

  /* Actual's own mobile bottom tab bar (Budget/Transaction/Accounts) is a
     fixed, full-width, 70px-tall bar flush with the viewport bottom
     (confirmed by live inspection). Below this width it always shows that
     bar, so raise this button to clear it; stays right-anchored (the
     text-scale control moves to the opposite, left side on mobile instead,
     so the two can never collide). */
  @media (max-width: 767px) {
    .actualmint-widget-builder {
      bottom: 76px;
      display: flex;
      flex-direction: column;
    }

    /* The panel normally opens downward below the toggle (margin-top).
       With the toggle now sitting just above Actual's own nav bar, opening
       downward would run the panel's content under that nav bar. Flip it
       to open upward instead (order: -1 needs the flex container above). */
    .actualmint-wb-panel {
      margin-top: 0;
      margin-bottom: 0.5rem;
      order: -1;
    }
  }

  .actualmint-wb-toggle {
    cursor: pointer;
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    border: 1px solid #333;
    background: #1f2937;
    color: #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .actualmint-wb-panel {
    margin-top: 0.5rem;
    width: 20rem;
    max-height: 28rem;
    overflow-y: auto;
    padding: 1rem;
    border-radius: 0.5rem;
    background: #fff;
    color: #111;
    border: 1px solid #ccc;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .actualmint-wb-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .actualmint-wb-field-label {
    font-weight: 600;
  }

  .actualmint-wb-filter {
    box-sizing: border-box;
    width: 100%;
  }

  .actualmint-wb-options {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 10rem;
    overflow-y: auto;
  }

  .actualmint-wb-error {
    color: #b91c1c;
  }

  .actualmint-wb-loading {
    color: #555;
  }

  .actualmint-wb-output {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .actualmint-wb-textarea {
    width: 100%;
    box-sizing: border-box;
    min-height: 4rem;
    font-family: monospace;
    font-size: 0.8rem;
  }

  .actualmint-wb-copy-status {
    font-size: 0.8rem;
    color: #555;
  }
</style>
