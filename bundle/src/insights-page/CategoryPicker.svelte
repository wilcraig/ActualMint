<script>
  // A small multi-picker: the chosen items as removable chips, plus a
  // select listing the rest (grouped under optgroups when items carry a
  // groupName). Used for categories, and also for payees and schedules.
  // An id that's selected but no longer among `items` (a deleted category,
  // say) still shows, so it can be removed.
  let { id, items = [], selected = [], onchange, placeholder = 'Add…', label = '' } = $props();

  let byId = $derived(new Map(items.map((item) => [item.id, item])));
  let available = $derived(items.filter((item) => !selected.includes(item.id)));
  let grouped = $derived.by(() => {
    const groups = new Map();
    for (const item of available) {
      const key = item.groupName ?? '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return [...groups.entries()];
  });

  function add(event) {
    const value = event.target.value;
    event.target.value = '';
    if (value && !selected.includes(value)) onchange([...selected, value]);
  }

  function remove(itemId) {
    onchange(selected.filter((s) => s !== itemId));
  }
</script>

<div class="picker" {id}>
  {#if selected.length > 0}
    <ul class="picker-chips">
      {#each selected as itemId (itemId)}
        <li class="picker-chip" data-id={itemId}>
          <span>{byId.get(itemId)?.name ?? '(no longer exists)'}</span>
          <button type="button" class="picker-remove" aria-label="Remove {byId.get(itemId)?.name ?? itemId}" onclick={() => remove(itemId)}>×</button>
        </li>
      {/each}
    </ul>
  {/if}
  <select class="picker-add abt-input" aria-label={label || placeholder} onchange={add} disabled={available.length === 0}>
    <option value="">{placeholder}</option>
    {#each grouped as [groupName, groupItems] (groupName)}
      {#if groupName}
        <optgroup label={groupName}>
          {#each groupItems as item (item.id)}
            <option value={item.id}>{item.name}</option>
          {/each}
        </optgroup>
      {:else}
        {#each groupItems as item (item.id)}
          <option value={item.id}>{item.name}</option>
        {/each}
      {/if}
    {/each}
  </select>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .picker-chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .picker-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 4px 0 8px;
    border-radius: 999px;
    font-size: 11px;
    background: color-mix(in srgb, currentColor 10%, transparent);
  }

  .picker-remove {
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0 4px;
    opacity: 0.7;
  }

  .picker-add {
    height: 30px;
    max-width: 280px;
    padding: 0 8px;
    border-radius: 6.5px;
    border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    background: color-mix(in srgb, currentColor 10%, transparent);
    color: inherit;
    font: inherit;
    font-size: 12px;
  }
</style>
