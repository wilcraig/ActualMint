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
// alongside the current `level`. That's enough to compute the breadcrumb
// and the next fetch at any level without replaying history, and it also
// means clicking into the same slice repeatedly can never accumulate
// duplicate history entries — there is no history array to append to, only
// a single current state that gets replaced.
//
// Levels, outermost to innermost: 'groups' -> 'categories' -> 'payees' ->
// 'transactions'. Three distinct entry points share this same state
// machine (disambiguated by which keys the caller passes to
// initialState()):
//   - a single category clicked in PacingBars: enters at 'payees', scoped
//     to that one category (and the real group it belongs to).
//   - a rollup bar clicked in PacingBars: enters at 'categories', scoped to
//     the rollup's own (arbitrary, not-a-real-group) category id list --
//     `categoryIds` is carried as sticky context through every further
//     transition, the same way `groupId`/`groupName` are for a normal
//     single-category entry, so zooming back out to 'categories' always
//     returns to this SAME rollup, never the real group of whichever
//     category happened to get clicked next.
//   - a standalone "pick your own groups" donut widget: enters at
//     'groups', scoped to a curated `groupIds` list (sticky context the
//     same way, so zooming back out to 'groups' shows that same curated
//     set, not every group).
// `categoryIds` and `groupIds` are therefore carried through every
// transition unchanged once set at entry; `groupId`/`groupName`/
// `categoryId`/`categoryName`/`payeeId`/`payeeName` are the "current
// position" fields that change as the user navigates.

const LEVELS = ['groups', 'categories', 'payees', 'transactions'];

function levelIndex(level) {
  return LEVELS.indexOf(level);
}

const EMPTY_POSITION = {
  groupId: null,
  groupName: null,
  categoryId: null,
  categoryName: null,
  payeeId: null,
  payeeName: null,
};

// Builds the initial state for whichever of the three entry shapes the
// caller passes:
//   - { categoryId, categoryName, groupId, groupName } -- single category.
//   - { categoryIds, rollupTitle } -- a rollup's member categories.
//   - { groupIds } -- a curated list of real groups.
export function initialState(options) {
  if (options.categoryId != null) {
    const { categoryId, categoryName, groupId, groupName } = options;
    return { ...EMPTY_POSITION, level: 'payees', groupId, groupName, categoryId, categoryName, categoryIds: null, groupIds: null };
  }

  if (options.categoryIds != null) {
    const { categoryIds, rollupTitle } = options;
    return { ...EMPTY_POSITION, level: 'categories', groupName: rollupTitle, categoryIds, groupIds: null };
  }

  // options.groupIds != null
  const { groupIds } = options;
  return { ...EMPTY_POSITION, level: 'groups', categoryIds: null, groupIds };
}

// Moves one level out: transactions -> payees -> categories -> groups.
// Zooming out from 'groups' is a documented no-op — it returns the same
// state unchanged (never null, never throws), so a modal wired naively to
// a "zoom out" button can call this repeatedly without ever getting stuck
// or crashing. `categoryIds`/`groupIds` (the sticky entry-point context)
// are always carried through unchanged.
export function zoomOut(state) {
  const index = levelIndex(state.level);
  if (index <= 0) {
    return state;
  }

  const targetLevel = LEVELS[index - 1];
  const sticky = { categoryIds: state.categoryIds, groupIds: state.groupIds };

  if (targetLevel === 'transactions') {
    // Unreachable: zoomOut is never called starting from before
    // 'transactions' into a level below 'groups'. Kept for exhaustiveness.
    return state;
  }

  if (targetLevel === 'payees') {
    return { ...EMPTY_POSITION, ...sticky, level: 'payees', groupId: state.groupId, groupName: state.groupName, categoryId: state.categoryId, categoryName: state.categoryName };
  }

  if (targetLevel === 'categories') {
    return { ...EMPTY_POSITION, ...sticky, level: 'categories', groupId: state.groupId, groupName: state.groupName };
  }

  // targetLevel === 'groups'
  return { ...EMPTY_POSITION, ...sticky, level: 'groups' };
}

// Drills one level in, into the clicked `slice` ({ id, label }). A no-op
// at the leaf level ('transactions') -- a single transaction row has
// nothing further to drill into -- returning the same state unchanged.
export function drillInto(state, slice) {
  const sticky = { categoryIds: state.categoryIds, groupIds: state.groupIds };

  if (state.level === 'groups') {
    return { ...EMPTY_POSITION, ...sticky, level: 'categories', groupId: slice.id, groupName: slice.label };
  }

  if (state.level === 'categories') {
    return { ...EMPTY_POSITION, ...sticky, level: 'payees', groupId: state.groupId, groupName: state.groupName, categoryId: slice.id, categoryName: slice.label };
  }

  if (state.level === 'payees') {
    return {
      ...EMPTY_POSITION,
      ...sticky,
      level: 'transactions',
      groupId: state.groupId,
      groupName: state.groupName,
      categoryId: state.categoryId,
      categoryName: state.categoryName,
      payeeId: slice.id,
      payeeName: slice.label,
    };
  }

  // state.level === 'transactions': leaf level, nothing to drill into.
  return state;
}
