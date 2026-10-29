// Copies text to the clipboard, falling back to the legacy
// document.execCommand('copy') mechanism when the async Clipboard API is
// unavailable - which it is on any plain-HTTP deployment, since
// navigator.clipboard.writeText requires a secure context (HTTPS or
// localhost) and Actual Insights is typically self-hosted over plain HTTP on a
// LAN.

/**
 * @param {string} text
 * @param {{
 *   clipboard?: { writeText: (t: string) => Promise<void> },
 *   execCommand?: (cmd: string) => boolean,
 *   doc?: Document,
 * }} [deps]
 * @returns {Promise<boolean>}
 */
export async function copyText(text, deps = {}) {
  const {
    clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined,
    execCommand = typeof document !== 'undefined'
      ? (...args) => document.execCommand(...args)
      : undefined,
    doc = typeof document !== 'undefined' ? document : undefined,
  } = deps;

  if (clipboard) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the execCommand fallback
    }
  }

  if (!execCommand || !doc) return false;

  const textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  doc.body.appendChild(textarea);

  try {
    textarea.select();
    return execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
