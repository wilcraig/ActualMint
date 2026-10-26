// Pure navigation-state for the category breakdown drill-down modal.
//
// No DOM, no fetch — just the level/identity bookkeeping needed to compute
// which `/api/spending-breakdown` request to make and which breadcrumb to
// render. Kept as a plain module (not Svelte state) so it's testable without
// mounting a component, and so the modal's own code stays a thin wrapper
// that calls these functions and re-fetches on every transition.
//
// Deliberate state shape: rather than a navigation *stack* (an array of
// past levels), NavState always carries the full identity it needs
// (groupId/groupName and, once known, categoryId/categoryName) alongside
// the current `level`. That's enough to compute the breadcrumb and the next
// fetch at any level without replaying history, and it also means
// clicking into the same slice repeatedly can never accumulate duplicate
// history entries — there is no history array to append to, only a single
// current state that gets replaced.
//
// Levels, outermost to innermost: 'groups' -> 'categories' -> 'payees'.
// The modal is always entered at 'payees' for the category the user
// clicked in PacingBars (confirmed entry point), since that's the
// category already selected in the pacing view.

const LEVELS = ['groups', 'categories', 'payees'];

function levelIndex(level) {
  return LEVELS.indexOf(level);
}

// Builds the initial state: level 'payees', scoped to the clicked
// category (and the group it belongs to, so zooming out doesn't need a
// fresh lookup).
export function initialState({ categoryId, categoryName, groupId, groupName }) {
  return {
    level: 'payees',
    groupId,
    groupName,
    categoryId,
    categoryName,
  };
}

// Moves one level out: payees -> categories -> groups. Zooming out from
// 'groups' is a documented no-op — it returns the same state unchanged
// (never null, never throws), so a modal wired naively to a "zoom out"
// button can call this repeatedly without ever getting stuck or crashing.
export function zoomOut(state) {
  const index = levelIndex(state.level);
  if (index <= 0) {
    return state;
  }

  const targetLevel = LEVELS[index - 1];

  if (targetLevel === 'groups') {
    return { level: 'groups', groupId: null, groupName: null, categoryId: null, categoryName: null };
  }

  // targetLevel === 'categories': drop the category identity, keep the
  // group identity (already known from the initial open).
  return {
    level: 'categories',
    groupId: state.groupId,
    groupName: state.groupName,
    categoryId: null,
    categoryName: null,
  };
}

// Drills one level in, into the clicked `slice` ({ id, label }). A no-op
// at the leaf level ('payees') — a payee slice has nothing further to
// drill into — returning the same state unchanged.
export function drillInto(state, slice) {
  if (state.level === 'groups') {
    return {
      level: 'categories',
      groupId: slice.id,
      groupName: slice.label,
      categoryId: null,
      categoryName: null,
    };
  }

  if (state.level === 'categories') {
    return {
      level: 'payees',
      groupId: state.groupId,
      groupName: state.groupName,
      categoryId: slice.id,
      categoryName: slice.label,
    };
  }

  // state.level === 'payees': leaf level, nothing to drill into.
  return state;
}
