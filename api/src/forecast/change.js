// New-or-changed rule: a persisting shortfall must not re-warn every day.
// Pure: takes the stored state and this run's breaches, returns who to warn
// and the state to store. Money is integer cents.
const MIN_CHANGE_CENTS = 2500;
const CHANGE_FRACTION = 0.05;

// Compared against the LAST-SENT shortfall (not the previous run's), so slow
// drift adds up and eventually sends.
// A state entry only persists while the breach is continuous (null clears it),
// so a today-dated breach with an earlier stored first date is the same
// episode: "already below" reports today as its first date every day.
function isChanged(prev, breach, today) {
  if (!prev) return true;
  const sameEpisode = breach.date === prev.firstDate || (breach.date === today && prev.firstDate <= today);
  if (!sameEpisode) return true;
  const threshold = Math.max(MIN_CHANGE_CENTS, CHANGE_FRACTION * prev.shortfallCents);
  return Math.abs(breach.shortfallCents - prev.shortfallCents) > threshold;
}

// today: YYYY-MM-DD in the same zone as breach dates.
// breaches: { [accountId]: null | { date, shortfallCents } } for every
// account checked this run. Accounts in state but not in breaches were not
// checked, so their entry is kept.
function decideWarnings({ breaches, state = {}, now, today }) {
  const toSend = [];
  const nextState = { ...state };

  for (const [accountId, breach] of Object.entries(breaches)) {
    if (!breach) {
      delete nextState[accountId];
    } else if (isChanged(state[accountId], breach, today)) {
      toSend.push(accountId);
      nextState[accountId] = {
        firstDate: breach.date,
        shortfallCents: breach.shortfallCents,
        sentAt: now.toISOString(),
      };
    }
  }

  return { toSend, nextState };
}

module.exports = { decideWarnings };
