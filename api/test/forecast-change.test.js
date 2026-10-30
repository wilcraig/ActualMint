const { decideWarnings } = require('../src/forecast/change');

const NOW = new Date('2026-10-30T12:00:00.000Z');
const prior = (firstDate, shortfallCents, sentAt = '2026-10-29T12:00:00.000Z') => ({ firstDate, shortfallCents, sentAt });

describe('decideWarnings', () => {
  test('no prior state and a breach is sent and recorded', () => {
    const { toSend, nextState } = decideWarnings({
      breaches: { a: { date: '2026-11-05', shortfallCents: 10000 } },
      state: {},
      now: NOW,
    });
    expect(toSend).toEqual(['a']);
    expect(nextState).toEqual({ a: { firstDate: '2026-11-05', shortfallCents: 10000, sentAt: NOW.toISOString() } });
  });

  test('same date and shortfall sends nothing and keeps the entry, sentAt not refreshed', () => {
    const state = { a: prior('2026-11-05', 10000) };
    const { toSend, nextState } = decideWarnings({
      breaches: { a: { date: '2026-11-05', shortfallCents: 10000 } },
      state,
      now: NOW,
    });
    expect(toSend).toEqual([]);
    expect(nextState).toEqual(state);
    expect(nextState.a.sentAt).toBe('2026-10-29T12:00:00.000Z');
  });

  test('small change on a small shortfall is quiet, over 2500 sends', () => {
    const state = { a: prior('2026-11-05', 10000) };
    const quiet = decideWarnings({ breaches: { a: { date: '2026-11-05', shortfallCents: 10200 } }, state, now: NOW });
    expect(quiet.toSend).toEqual([]);
    expect(quiet.nextState).toEqual(state);
    const loud = decideWarnings({ breaches: { a: { date: '2026-11-05', shortfallCents: 12600 } }, state, now: NOW });
    expect(loud.toSend).toEqual(['a']);
    expect(loud.nextState.a).toEqual({ firstDate: '2026-11-05', shortfallCents: 12600, sentAt: NOW.toISOString() });
  });

  test('5 percent threshold applies on a large shortfall', () => {
    const state = { a: prior('2026-11-05', 100000) };
    const quiet = decideWarnings({ breaches: { a: { date: '2026-11-05', shortfallCents: 104000 } }, state, now: NOW });
    expect(quiet.toSend).toEqual([]);
    const loud = decideWarnings({ breaches: { a: { date: '2026-11-05', shortfallCents: 106000 } }, state, now: NOW });
    expect(loud.toSend).toEqual(['a']);
  });

  test('compares against the last-sent shortfall so slow drift eventually sends', () => {
    let state = { a: prior('2026-11-05', 10000) };
    const step = (cents) => {
      const r = decideWarnings({ breaches: { a: { date: '2026-11-05', shortfallCents: cents } }, state, now: NOW });
      state = r.nextState;
      return r.toSend;
    };
    expect(step(11500)).toEqual([]);
    expect(step(13000)).toEqual(['a']);
  });

  test('different first date with the same amount sends', () => {
    const state = { a: prior('2026-11-05', 10000) };
    const { toSend, nextState } = decideWarnings({
      breaches: { a: { date: '2026-11-03', shortfallCents: 10000 } },
      state,
      now: NOW,
    });
    expect(toSend).toEqual(['a']);
    expect(nextState.a.firstDate).toBe('2026-11-03');
  });

  test('a resolved breach clears the entry, sends nothing, and a later breach is new', () => {
    const state = { a: prior('2026-11-05', 10000), b: prior('2026-11-06', 500) };
    const resolved = decideWarnings({ breaches: { a: null }, state, now: NOW });
    expect(resolved.toSend).toEqual([]);
    expect(resolved.nextState).toEqual({ b: state.b });
    const again = decideWarnings({
      breaches: { a: { date: '2026-11-05', shortfallCents: 10000 } },
      state: resolved.nextState,
      now: NOW,
    });
    expect(again.toSend).toEqual(['a']);
  });

  test('an account missing from breaches keeps its state', () => {
    const state = { a: prior('2026-11-05', 10000) };
    const { toSend, nextState } = decideWarnings({ breaches: {}, state, now: NOW });
    expect(toSend).toEqual([]);
    expect(nextState).toEqual(state);
  });

  test('does not mutate the input state', () => {
    const state = { a: prior('2026-11-05', 10000) };
    const snapshot = JSON.parse(JSON.stringify(state));
    decideWarnings({ breaches: { a: null }, state, now: NOW });
    expect(state).toEqual(snapshot);
  });
});
