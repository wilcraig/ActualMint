// Finds a stable insertion point on Actual's own Settings page so
// Actual Insights' own settings (text size, Fresh theme) can live as a
// real settings card instead of a floating button on every page.
//
// Actual has no plugin API for this, so there's no "add a settings card"
// hook to call. Confirmed by live inspection: a settings card is reached
// by walking up from its exact-text heading until the ancestor's *parent*
// is the card stack itself (many sibling cards: Actual info, Themes,
// Formatting, Language, Authentication, encryption, budget type, export,
// advanced...). That parent-child-count jump (from 1-2 up to double
// digits) is what distinguishes the actual card boundary from the few
// wrapper divs directly around the heading text.
//
// Confirmed live on a real deployment: the Actual Budget Tweaks (ABT)
// sidecar, when installed, REPLACES Actual's own "Themes" card entirely
// with its own theme-picker panel in that exact same card-stack slot --
// Actual's native "Themes change the user interface colors." text is gone
// from the page completely, not just hidden. Anchoring only on "Themes"
// silently strands the settings card at the end of <body>, hidden
// forever, on any ABT install. Try ABT's own "Actual Budget Tweaks"
// heading next, landing the card right after ABT's panel instead --
// matching what the user asked for ("in ABT settings, or below/above it").

const CARD_STACK_MIN_SIBLINGS = 3;
const ANCHOR_HEADINGS = ['Themes', 'Actual Budget Tweaks'];

export function isSettingsPath(pathname) {
  return pathname === '/settings';
}

function findCardByHeading(doc, headingText) {
  const heading = Array.from(doc.querySelectorAll('*')).find(
    (el) => el.children.length === 0 && el.textContent.trim() === headingText,
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

export function findThemesCard(doc) {
  return findCardByHeading(doc, 'Themes');
}

// Tries each known heading in order, returning the first card found. Used
// instead of findThemesCard() alone so the settings card still lands
// somewhere sensible when ABT has replaced Actual's native Themes card.
export function findSettingsAnchor(doc) {
  for (const heading of ANCHOR_HEADINGS) {
    const card = findCardByHeading(doc, heading);
    if (card) return card;
  }
  return null;
}
