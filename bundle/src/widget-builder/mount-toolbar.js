import { isReportsPath, watchRoute } from './route-watcher';
import { findAddWidgetButton } from './toolbar-anchor';

// Mounts `PanelComponent` once into a persistent, detached container, then
// re-parents that same container right after Actual's own "Add new
// widget" button every time the user is on a Reports page -- a real DOM
// sibling in the toolbar's normal flow, not a `position: fixed` overlay
// with its position computed from the button's bounding rect.
//
// `position: fixed` + JS-computed pixel coordinates was tried first and
// confirmed broken live: ActualMint's own CSS `zoom` (the text-size
// control, see text-scale.js) scales `getBoundingClientRect()` results
// one way but re-applies that same zoom a second time to a `position:
// fixed` descendant's own `top`/`left`, so at any zoom other than 1x
// (i.e. any text size but "Normal") the panel landed hundreds of pixels
// off to the side, confirmed off-screen entirely at "Large". A normal
// in-flow sibling has no such coordinate space to get zoomed twice.
export function mountWidgetBuilderPanel(doc, win, PanelComponent) {
  const container = doc.createElement('div');
  container.style.display = 'none';
  doc.body.appendChild(container);

  new PanelComponent({ target: container });

  let observer = null;

  function attachTo(button) {
    // inline-block, not block, so this sits next to the button in the
    // toolbar's normal flow instead of dropping to its own line.
    container.style.display = 'inline-block';
    button.insertAdjacentElement('afterend', container);
  }

  function stopObserving() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function startWatching() {
    const button = findAddWidgetButton(doc);
    if (button) {
      attachTo(button);
      return;
    }
    observer = new win.MutationObserver(() => {
      const found = findAddWidgetButton(doc);
      if (found) {
        stopObserving();
        attachTo(found);
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  return watchRoute(win, (pathname) => {
    stopObserving();
    if (isReportsPath(pathname)) {
      startWatching();
    } else {
      container.style.display = 'none';
    }
  });
}
