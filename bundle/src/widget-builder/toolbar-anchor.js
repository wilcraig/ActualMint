// Finds Actual's own "Add new widget" button on the Reports page, so the
// widget-builder panel's trigger can sit right next to it instead of
// floating at a fixed screen corner.

export function findAddWidgetButton(doc) {
  return (
    Array.from(doc.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === 'Add new widget',
    ) ?? null
  );
}
