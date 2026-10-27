import { isSettingsPath, findThemesCard } from './settings-anchor';
import { watchRoute } from '../widget-builder/route-watcher';

const MAX_ATTACH_ATTEMPTS = 20;
const ATTACH_RETRY_MS = 100;

// Mounts `SettingsSectionComponent` once into a persistent, detached
// container, then re-parents that same container next to Actual's own
// "Themes" settings card every time the user is on /settings. The
// component instance is created exactly once and never destroyed -- only
// the container's place in the document changes -- so its own state
// (edits mid-flight, if any) survives navigating away from /settings and
// back.
//
// Settings page content can render a tick after the route change fires
// (confirmed live), so a single find-and-attach attempt right after
// navigating is unreliable. Retrying briefly on a short interval, capped
// at MAX_ATTACH_ATTEMPTS, covers that without polling forever if the
// anchor never appears (e.g. a future Actual version restructures the
// page).
export function mountSettingsSection(doc, win, SettingsSectionComponent) {
  const container = doc.createElement('div');
  container.style.display = 'none';
  doc.body.appendChild(container);

  new SettingsSectionComponent({ target: container });

  let attempt = 0;
  let retryTimer = null;

  function tryAttach() {
    const anchor = findThemesCard(doc);
    if (anchor) {
      // Match the native settings card's chrome (border/background/
      // spacing/width) directly from the live anchor rather than guessing
      // at which CSS custom property drives it, so this still looks right
      // under Light, Dark, Midnight, and the Mint-style recolor alike.
      // Longhand properties only, set one at a time -- aggregate shorthands
      // (`padding`, `border`) are unreliable to both read AND write as a
      // single `cssText` string across computed-style implementations
      // (confirmed in jsdom: assigning several longhands via one `cssText`
      // string gets silently re-serialized into a shorthand internally,
      // after which the individual longhand getters stop round-tripping),
      // while each longhand set directly as its own property is a real
      // underlying value everywhere.
      const cardStyle = doc.defaultView.getComputedStyle(anchor);
      const style = container.style;
      style.display = 'block';
      style.boxSizing = 'border-box';
      style.width = cardStyle.width;
      style.marginTop = cardStyle.marginTop || '20px';
      style.paddingTop = cardStyle.paddingTop;
      style.paddingRight = cardStyle.paddingRight;
      style.paddingBottom = cardStyle.paddingBottom;
      style.paddingLeft = cardStyle.paddingLeft;
      style.borderTopWidth = cardStyle.borderTopWidth;
      style.borderRightWidth = cardStyle.borderTopWidth;
      style.borderBottomWidth = cardStyle.borderTopWidth;
      style.borderLeftWidth = cardStyle.borderTopWidth;
      style.borderStyle = cardStyle.borderTopStyle;
      style.borderColor = cardStyle.borderTopColor;
      style.borderRadius = cardStyle.borderTopLeftRadius;
      style.backgroundColor = cardStyle.backgroundColor;
      style.color = cardStyle.color;
      style.fontFamily = cardStyle.fontFamily;
      style.fontSize = cardStyle.fontSize;
      anchor.insertAdjacentElement('afterend', container);
      return;
    }
    attempt += 1;
    if (attempt < MAX_ATTACH_ATTEMPTS) {
      retryTimer = win.setTimeout(tryAttach, ATTACH_RETRY_MS);
    }
  }

  return watchRoute(win, (pathname) => {
    if (retryTimer) {
      win.clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (isSettingsPath(pathname)) {
      attempt = 0;
      tryAttach();
    } else {
      container.style.display = 'none';
    }
  });
}
