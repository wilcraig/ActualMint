// Finds a stable insertion point on Actual's own Settings page so
// ActualMint's own settings (text size, Mint-style theme) can live as a
// real settings card instead of a floating button on every page.
//
// Actual has no plugin API for this, so there's no "add a settings card"
// hook to call. Confirmed by live inspection: the "Themes" card is reached
// by walking up from its exact-text "Themes" heading until the ancestor's
// *parent* is the card stack itself (10 sibling cards: Actual info, Themes,
// Formatting, Language, Authentication, encryption, budget type, export,
// advanced...). That parent-child-count jump (from 1-2 up to double digits)
// is what distinguishes the actual card boundary from the few wrapper divs
// directly around the heading text.

const CARD_STACK_MIN_SIBLINGS = 3;

export function isSettingsPath(pathname) {
  return pathname === '/settings';
}

export function findThemesCard(doc) {
  const heading = Array.from(doc.querySelectorAll('*')).find(
    (el) => el.children.length === 0 && el.textContent.trim() === 'Themes',
  );
  if (!heading) return null;

  let el = heading;
  while (el) {
    const parent = el.parentElement;
    if (parent && parent.children.length > CARD_STACK_MIN_SIBLINGS) {
      return el;
    }
    el = parent;
  }
  return null;
}
