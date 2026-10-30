import { isInsightsPageHash, navigateToInsights, INSIGHTS_PAGE_HASH } from './route';
import { watchRoute } from '../widget-builder/route-watcher';

// Adds an "Insights" item to whichever sidebar is showing -- Actual's own,
// or Actual Budget Tweaks' "Live sidebar" (Standard or Split layout),
// which replaces it -- and marks it selected while the Insights page is
// open. Markup and selected states are documented, with live examples, in
// docs/insights-page-hosting-notes.md.
//
// Every class name involved is a build hash (emotion's `css-…`, Svelte's
// `svelte-…`) that changes between releases, so the item is never built
// from known classes: it's a deep clone of the sidebar's own "Reports"
// item with the label and icon swapped, inserted after "Schedules".
// Clones carry none of React's or Svelte's event wiring (both keep it in
// expando properties, which cloneNode doesn't copy), so the only click
// handler on it is ours.
//
// Both frameworks re-render their sidebars (Actual on navigation, ABT on
// live balance updates and layout switches), dropping foreign nodes now
// and then, so a MutationObserver re-checks on every DOM change: exactly
// one item per sidebar, re-added when missing.

const ENTRY_ATTR = 'data-insights-nav';
const LINK_ATTR = 'data-insights-link';
const LABEL = 'Insights';
const SVG_NS = 'http://www.w3.org/2000/svg';

// Lucide "lightbulb", the same icon set ABT's sidebar uses.
const ICON_PATHS = [
  'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5',
  'M9 18h6',
  'M10 22h4',
];

function leafWithText(root, text) {
  return Array.from(root.querySelectorAll('*')).find(
    (el) => el.children.length === 0 && el.textContent.trim() === text,
  );
}

// The child of `container` that holds `el` (Actual wraps each link in a
// div; ABT's buttons are direct children).
function topChild(container, el) {
  let node = el;
  while (node && node.parentElement !== container) node = node.parentElement;
  return node;
}

// Every sidebar currently in the DOM, as { kind, container, template,
// anchor, root }: `template` is the Reports item to clone, `anchor` the
// item to insert after, `root` where the sidebar's other (possibly
// active) items live. With ABT's live sidebar on, Actual's own is still
// in the DOM at 0x0; it gets an item too, harmlessly invisible.
function findSidebars(doc) {
  const found = [];

  for (const container of doc.querySelectorAll('[data-testid="sidebar-primary-buttons"]')) {
    const reports = container.querySelector('a[href="/reports"]');
    if (!reports) continue;
    const schedules = container.querySelector('a[href="/schedules"]');
    found.push({
      kind: 'native',
      container,
      template: topChild(container, reports),
      anchor: topChild(container, schedules || reports),
      root: container,
    });
  }

  for (const root of doc.querySelectorAll('.sidebar')) {
    const byLabel = (label) =>
      root.querySelector(`button[aria-label="${label}"]:not([${ENTRY_ATTR}])`) ||
      Array.from(root.querySelectorAll(`button:not([${ENTRY_ATTR}])`)).find(
        (b) => b.textContent.trim() === label,
      );
    const reports = byLabel('Reports');
    if (!reports) continue;
    const schedules = byLabel('Schedules');
    const anchor = schedules && schedules.parentElement === reports.parentElement ? schedules : reports;
    found.push({ kind: 'abt', container: reports.parentElement, template: reports, anchor, root });
  }

  return found;
}

// Actual's links share an emotion class per level (top-level vs the
// "More" items), visible on the link's first child; used to pair an
// active link with an inactive one of the same level.
function levelOf(link) {
  return link.firstElementChild?.getAttribute('class') ?? '';
}

function inactiveClassFor(container, link) {
  const peer = Array.from(container.querySelectorAll(`a[href]:not([${LINK_ATTR}])`)).find(
    (a) => a !== link && !a.hasAttribute('aria-current') && levelOf(a) === levelOf(link),
  );
  return peer ? peer.getAttribute('class') : null;
}

function buildIcon(doc, templateSvg) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const attr of ['width', 'height', 'style']) {
    const value = templateSvg?.getAttribute(attr);
    if (value != null) svg.setAttribute(attr, value);
  }
  const templateClass = templateSvg?.getAttribute('class') ?? '';
  if (templateClass.includes('lucide')) svg.setAttribute('class', 'lucide lucide-lightbulb lucide-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', templateSvg?.getAttribute('stroke-width') ?? '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICON_PATHS) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function buildEntry(doc, win, sidebar) {
  const entry = sidebar.template.cloneNode(true);
  entry.setAttribute(ENTRY_ATTR, '1');
  const link = entry.matches('a, button') ? entry : entry.querySelector('a, button');
  link.setAttribute(LINK_ATTR, '1');
  link.removeAttribute('aria-current');
  link.removeAttribute('aria-expanded');
  link.removeAttribute('data-discover');
  link.removeAttribute('id');

  if (sidebar.kind === 'native') {
    link.setAttribute('href', INSIGHTS_PAGE_HASH);
    // The clone's class is the inactive one unless Reports itself was the
    // active page when we cloned it.
    const inactive = sidebar.template.querySelector('a').hasAttribute('aria-current')
      ? inactiveClassFor(sidebar.container, sidebar.template.querySelector('a'))
      : sidebar.template.querySelector('a').getAttribute('class');
    if (inactive) link.setAttribute('class', inactive);
    link.dataset.insightsInactiveClass = link.getAttribute('class') ?? '';
  } else {
    link.classList.remove('active');
  }

  if (link.hasAttribute('aria-label')) link.setAttribute('aria-label', LABEL);
  if (link.hasAttribute('title')) link.setAttribute('title', LABEL);
  const label = leafWithText(entry, 'Reports');
  if (label) label.textContent = LABEL;

  const oldIcon = entry.querySelector('svg');
  if (oldIcon) oldIcon.replaceWith(buildIcon(doc, oldIcon));

  link.addEventListener('click', (event) => {
    event.preventDefault();
    navigateToInsights(win);
  });
  return entry;
}

export function mountSidebarEntry(doc, win) {
  // Items we un-highlighted while the page is open (the route Actual is
  // still rendering underneath), with their original attributes to put
  // back. Classes rather than inline styles, since both sidebars style
  // the selected item's children too (icon color) off the item's class.
  // Safe to put back on close: closing happens inside history.pushState
  // (watchRoute), before React or Svelte re-render for the new route.
  const suppressed = new Map();
  // Actual's top-level "selected" class, remembered for when the page
  // opens over a route whose own item is a "More" item (a different
  // level, so its class would mis-size ours).
  let nativeActiveClass = null;
  let observer = null;

  function suppress(el, applyInactive) {
    if (suppressed.has(el)) return;
    suppressed.set(el, {
      className: el.getAttribute('class'),
      ariaCurrent: el.getAttribute('aria-current'),
    });
    applyInactive(el);
  }

  function restoreAll() {
    for (const [el, { className, ariaCurrent }] of suppressed) {
      if (className == null) el.removeAttribute('class');
      else el.setAttribute('class', className);
      if (ariaCurrent == null) el.removeAttribute('aria-current');
      else el.setAttribute('aria-current', ariaCurrent);
    }
    suppressed.clear();
  }

  // An item turning active while the page is open means the framework
  // moved its highlight (the back button, seen live), so every item we
  // un-highlighted earlier in that sidebar is no longer its active one.
  // It may never say so -- Svelte's class directive un-marks with
  // classList.toggle, a silent no-op on an item we already un-marked --
  // so forget them here rather than restore a stale highlight on close.
  function forgetStale(root, actives) {
    if (actives.length === 0) return;
    for (const el of suppressed.keys()) {
      if (root.contains(el) && !actives.includes(el)) suppressed.delete(el);
    }
  }

  function selectNative(sidebar, link) {
    const active = sidebar.root.querySelector(`a[aria-current="page"]:not([${LINK_ATTR}])`);
    if (active) forgetStale(sidebar.root, [active]);
    if (active) {
      const original = active.getAttribute('class');
      if (levelOf(active) === levelOf(link)) nativeActiveClass = original;
      else if (!nativeActiveClass) borrowAccent(link, active);
      const inactive = inactiveClassFor(sidebar.container, active);
      suppress(active, (el) => {
        if (inactive) el.setAttribute('class', inactive);
        else el.classList.remove('active');
        el.removeAttribute('aria-current');
      });
    }
    if (nativeActiveClass) {
      clearAccent(link);
      link.setAttribute('class', nativeActiveClass);
    } else {
      link.setAttribute('class', `${link.dataset.insightsInactiveClass} active`);
    }
    link.setAttribute('aria-current', 'page');
  }

  // Fallback when no top-level item has been selected since the page
  // loaded (a reload straight onto Payees or Settings, seen live), so
  // there's no top-level selected class to borrow: copy the selected
  // "More" item's accent -- text color and left border -- inline, giving
  // back the border's width from the left padding so the label doesn't
  // shift. Inline styles on our own element only.
  function borrowAccent(link, active) {
    const from = win.getComputedStyle(active);
    const borderWidth = parseFloat(from.borderLeftWidth) || 0;
    const ownPadding = parseFloat(win.getComputedStyle(link).paddingLeft);
    link.style.color = from.color;
    link.style.borderLeftWidth = from.borderLeftWidth;
    link.style.borderLeftStyle = from.borderLeftStyle;
    link.style.borderLeftColor = from.borderLeftColor;
    if (!Number.isNaN(ownPadding) && borderWidth > 0) {
      link.style.paddingLeft = `${Math.max(0, ownPadding - borderWidth)}px`;
    }
  }

  function clearAccent(link) {
    for (const prop of ['color', 'border-left-width', 'border-left-style', 'border-left-color', 'padding-left']) {
      link.style.removeProperty(prop);
    }
  }

  function selectAbt(sidebar, link) {
    const actives = Array.from(sidebar.root.querySelectorAll(`button.active:not([${LINK_ATTR}])`));
    forgetStale(sidebar.root, actives);
    for (const active of actives) suppress(active, (el) => el.classList.remove('active'));
    link.classList.add('active');
  }

  function deselect(sidebar, link) {
    if (sidebar.kind === 'native') {
      clearAccent(link);
      link.setAttribute('class', link.dataset.insightsInactiveClass);
      link.removeAttribute('aria-current');
    } else {
      link.classList.remove('active');
    }
  }

  function ensure() {
    const open = isInsightsPageHash(win.location.hash);
    if (!open) restoreAll();

    for (const sidebar of findSidebars(doc)) {
      const existing = sidebar.container.querySelectorAll(`:scope > [${ENTRY_ATTR}]`);
      let entry = existing[0];
      for (let i = 1; i < existing.length; i += 1) existing[i].remove();
      if (!entry) {
        entry = buildEntry(doc, win, sidebar);
        sidebar.anchor.insertAdjacentElement('afterend', entry);
      }
      const link = entry.matches(`[${LINK_ATTR}]`) ? entry : entry.querySelector(`[${LINK_ATTR}]`);
      if (!open) deselect(sidebar, link);
      else if (sidebar.kind === 'native') selectNative(sidebar, link);
      else selectAbt(sidebar, link);
    }
  }

  // Our own writes (inserting the item, toggling classes) would otherwise
  // re-trigger the observer forever; disconnecting also drops any records
  // they already queued.
  //
  // While the page is open it also watches class/aria-current changes in
  // each sidebar: that's React or Svelte moving the highlight (seen live
  // with the back button, whose popstate reaches us before the framework
  // re-renders). A framework write to an item we un-highlighted means the
  // framework owns that item's state again, so it's dropped from
  // `suppressed` and never restored stale; the re-run then un-highlights
  // whichever item is active now.
  function onMutations(records) {
    for (const record of records) {
      if (record.type === 'attributes') suppressed.delete(record.target);
    }
    run();
  }

  function run() {
    if (observer) observer.disconnect();
    let sidebars = [];
    try {
      ensure();
      if (isInsightsPageHash(win.location.hash)) sidebars = findSidebars(doc);
    } catch {
      // Never let a surprise in Actual's or ABT's markup break the page.
    }
    if (!observer) return;
    observer.observe(doc.body, { childList: true, subtree: true });
    for (const { root } of sidebars) {
      observer.observe(root, {
        attributes: true,
        attributeFilter: ['class', 'aria-current'],
        subtree: true,
      });
    }
  }

  observer = new win.MutationObserver(onMutations);
  win.addEventListener('hashchange', run);
  const unwatch = watchRoute(win, run);

  return function unmount() {
    unwatch();
    win.removeEventListener('hashchange', run);
    observer.disconnect();
    observer = null;
    restoreAll();
    doc.querySelectorAll(`[${ENTRY_ATTR}]`).forEach((el) => el.remove());
  };
}
