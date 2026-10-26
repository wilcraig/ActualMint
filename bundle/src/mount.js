// Finds a placeholder left inside an Actual Reports "Text widget" and mounts
// a real component in its place. The placeholder convention (and the
// TreeWalker technique below) follows Actual Budget Tweaks' own
// `placeholderOf()` helper in `income-breakdown/index.ts`.

const CLOSING = '}}';

/**
 * Walk the live DOM for a text node whose content starts with `prefix`,
 * parse the JSON between the prefix and the matching closing `}}`, and
 * return the containing element plus the parsed config.
 *
 * @param {string} prefix e.g. "{{ACTUALMINT:pacing-bars:"
 * @returns {{ node: HTMLElement, config: unknown } | null}
 */
export function findPlaceholder(prefix) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  let textNode;
  // eslint-disable-next-line no-cond-assign
  while ((textNode = walker.nextNode())) {
    const text = textNode.nodeValue;
    if (!text) continue;

    const start = text.indexOf(prefix);
    if (start === -1) continue;

    const jsonStart = start + prefix.length;
    const end = text.indexOf(CLOSING, jsonStart);
    if (end === -1) continue;

    const rawConfig = text.slice(jsonStart, end);

    let config;
    try {
      config = JSON.parse(rawConfig);
    } catch {
      continue;
    }

    const host = textNode.parentElement;
    if (!host) continue;

    return { node: host, config };
  }

  return null;
}

const OBSERVE_OPTIONS = { childList: true, subtree: true, characterData: true };

/**
 * Watches the DOM for a placeholder matching `prefix` (including after
 * Actual's own client-side navigation) and calls `render(host, config)`
 * exactly once per distinct host element, hiding the placeholder text
 * first. Errors thrown by `render` are caught, logged, and never propagate.
 *
 * @param {string} prefix
 * @param {(host: HTMLElement, config: unknown) => void} render
 */
export function mountWidget(prefix, render) {
  const mounted = new WeakSet();
  let scheduled = false;

  const scan = () => {
    scheduled = false;

    // A mutation callback can still fire after the page (or, in tests, the
    // DOM environment) has gone away; bail out rather than throw.
    if (typeof document === 'undefined') return;

    const found = findPlaceholder(prefix);
    if (!found) return;

    const { node: host, config } = found;
    if (mounted.has(host)) return;
    mounted.add(host);

    // Mutating the host ourselves (clearing the placeholder, then letting
    // `render` populate it) would otherwise re-trigger this same observer.
    // Disconnect for the duration of our own write, then resume watching
    // for the next placeholder to appear elsewhere in the document.
    observer.disconnect();
    host.textContent = '';

    try {
      render(host, config);
    } catch (error) {
      console.error('[ActualMint] mountWidget render callback threw:', error);
    } finally {
      observer.observe(document.body, OBSERVE_OPTIONS);
    }
  };

  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(scan);
  });

  observer.observe(document.body, OBSERVE_OPTIONS);

  // Run once immediately in case the placeholder is already present.
  scan();
}
