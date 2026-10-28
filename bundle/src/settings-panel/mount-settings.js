import { isSettingsPath, findSettingsAnchor } from './settings-anchor';
import { watchRoute } from '../widget-builder/route-watcher';

// Mounts `SettingsSectionComponent` once into a persistent, detached
// container, then re-parents that same container next to a settings card
// (Actual's own "Themes", or Actual Budget Tweaks' panel in its place --
// see settings-anchor.js) every time the user is on /settings. The
// component instance is created exactly once and never destroyed -- only
// the container's place in the document changes -- so its own state
// (edits mid-flight, if any) survives navigating away from /settings and
// back.
//
// A time-capped retry loop was tried first and confirmed too fragile on a
// real deployment: Actual Budget Tweaks' own settings panel can take
// several seconds to render (real sync + a large settings list), well
// past any reasonable fixed timeout, after which the section was
// permanently stranded hidden at the end of <body>. A MutationObserver
// instead waits exactly as long as it actually takes, with no arbitrary
// cutoff, and costs nothing once the anchor shows up (stops observing
// immediately).
export function mountSettingsSection(doc, win, SettingsSectionComponent) {
  const container = doc.createElement('div');
  container.style.display = 'none';
  doc.body.appendChild(container);

  new SettingsSectionComponent({ target: container });

  let observer = null;

  function attachTo(anchor) {
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

    // The component instance is created exactly once (see above) and its
    // children (e.g. GoalsList) only fetch on their own initial mount, so
    // without this they'd never refetch after the first time the bundle
    // happened to load on /settings -- breaking workflows like "enable
    // carryover on a category, then go add a goal for it" without a hard
    // page reload. Dispatched every time we actually (re)attach next to a
    // found anchor, so children can listen and refresh their own data.
    doc.dispatchEvent(new win.CustomEvent('actualmint:settings-attached'));
  }

  function stopObserving() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function startWatching() {
    const anchor = findSettingsAnchor(doc);
    if (anchor) {
      attachTo(anchor);
      return;
    }
    observer = new win.MutationObserver(() => {
      const found = findSettingsAnchor(doc);
      if (found) {
        stopObserving();
        attachTo(found);
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  return watchRoute(win, (pathname) => {
    stopObserving();
    if (isSettingsPath(pathname)) {
      startWatching();
    } else {
      container.style.display = 'none';
    }
  });
}
