<script>
  import { onMount } from 'svelte';
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
  let generatedText = $state('');
  let copyStatus = $state('');

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
      pickerData = { ...pickerData, [field.key]: data[responseKey] };
    } catch {
      pickerErrors = { ...pickerErrors, [field.key]: describePickerError(null) };
    }
  }

  function selectWidget(widgetId) {
    selectedWidgetId = widgetId;
    values = {};
    generatedText = '';
    copyStatus = '';

    const widget = WIDGET_REGISTRY.find((w) => w.id === widgetId);
    if (!widget) return;

    for (const field of widget.fields) {
      if (field.type === 'category-multiselect' || field.type === 'account-multiselect') {
        values[field.key] = [];
        loadPickerData(field);
      }
    }
  }

  function toggleOpen() {
    open = !open;
  }

  function toggleOption(fieldKey, optionId) {
    const current = values[fieldKey] ?? [];
    values[fieldKey] = current.includes(optionId)
      ? current.filter((id) => id !== optionId)
      : [...current, optionId];
  }

  function handleGenerate() {
    if (!selectedWidget) return;
    generatedText = buildPlaceholder(selectedWidget.id, selectedWidget.fields, values);
    copyStatus = '';
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
                <ul class="actualmint-wb-options">
                  {#each pickerData[field.key] as option (option.id)}
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

        <button type="button" class="actualmint-wb-generate" onclick={handleGenerate}>
          Generate
        </button>

        <div class="actualmint-wb-output">
          <textarea
            class="actualmint-wb-textarea"
            readonly
            value={generatedText}
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
