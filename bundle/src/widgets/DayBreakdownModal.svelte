<script>
  import SpendingBreakdownDonut from './SpendingBreakdownDonut.svelte';

  // Mounted onto document.body by its caller (see PacingBars.svelte for why:
  // dashboard tiles are transformed, which would trap a position:fixed backdrop).
  let { date, title, onClose = () => {} } = $props();

  function handleKeydown(event) {
    if (event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="actualmint-day-modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onClose()}>
  <div class="actualmint-day-modal" role="dialog" aria-modal="true" aria-label={title}>
    <div class="day-modal-header">
      <h2 class="day-modal-title">{title}</h2>
      <button type="button" class="day-modal-close" aria-label="Close" onclick={() => onClose()}>×</button>
    </div>
    <SpendingBreakdownDonut {date} showLegend={true} />
  </div>
</div>

<style>
  .actualmint-day-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .actualmint-day-modal {
    background: #fff;
    color: #111827;
    border-radius: 0.5rem;
    padding: 1rem;
    width: 90%;
    max-width: 440px;
    max-height: 85vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .day-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .day-modal-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .day-modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    color: #555;
  }
</style>
