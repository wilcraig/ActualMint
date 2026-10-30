const { decideWarnings } = require('../src/forecast/change');

const NOW = new Date('2026-10-30T12:00:00.000Z');
const TODAY = '2026-10-30';
const prior = (firstDate, shortfallCents, sentAt = '2026-10-29T12:00:00.000Z') => ({ firstDate, shortfallCents, sentAt });

describe('decideWarnings', () => {
  test('no prior state and a breach is sent and recorded', () => {
    const { toSend, nextState } = decideWarnings({
      breaches: { a: { date: '2026-11-05', shortfallCents: 10000 } },
      state: {},
      now: NOW,
      today: TODAY,
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
      today: TODAY,
    });
    expect(toSend).toEqual([]);
    expect(nextState).toEqual(state);
    expect(nextState.a.sentAt).toBe('2026-10-29T12:00:00.000Z');
  });

  test('small change on a small shortfall is quiet, over 2500 sends', () => {
    const state = { a: prior('2026-11-05', 10000) };
    const quiet = decideWarnings({ breaches: { a: { date: '2026-11-05', shortfallCents: 10200 } }, state, now: NOW, today: TODAY });
    expect(quiet.toSend).toEqual([]);
    expect(quiet.nextState).toEqual(state);
    const loud = decideWarnings({ breaches: { a: { date: '2026-11-05', shortfallCents: 12600 } }, state, now: NOW, today: TODAY });
    expect(loud.toSend).toEqual(['a']);
    expect(loud.nextState.a).toEqual({ firstDate: '2026-11-05', shortfallCents: 12600, sentAt: NOW.toISOString() });
  });

  test('5 percent threshold applies on a large shortfall', () => {
    const state = { a: prior('2026-11-05', 100000) };
    const quiet = decideWarnings({ breaches: { a: { date: '2026-11-05', shortfallCents: 104000 } }, state, now: NOW, today: TODAY });
    expect(quiet.toSend).toEqual([]);
    const loud = decideWarnings({ breaches: { a: { date: '2026-11-05', shortfallCents: 106000 } }, state, now: NOW, today: TODAY });
    expect(loud.toSend).toEqual(['a']);
  });

  test('compares against the last-sent shortfall so slow drift eventually sends', () => {
    let state = { a: prior('2026-11-05', 10000) };
    const step = (cents) => {
      const r = decideWarnings({ breaches: { a: { date: '2026-11-05', shortfallCents: cents } }, state, now: NOW, today: TODAY });
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
      today: TODAY,
    });
    expect(toSend).toEqual(['a']);
    expect(nextState.a.firstDate).toBe('2026-11-03');
  });

  test('a resolved breach clears the entry, sends nothing, and a later breach is new', () => {
    const state = { a: prior('2026-11-05', 10000), b: prior('2026-11-06', 500) };
    const resolved = decideWarnings({ breaches: { a: null }, state, now: NOW, today: TODAY });
    expect(resolved.toSend).toEqual([]);
    expect(resolved.nextState).toEqual({ b: state.b });
    const again = decideWarnings({
      breaches: { a: { date: '2026-11-05', shortfallCents: 10000 } },
      state: resolved.nextState,
      now: NOW,
      today: TODAY,
    });
    expect(again.toSend).toEqual(['a']);
  });

  test('an account missing from breaches keeps its state', () => {
    const state = { a: prior('2026-11-05', 10000) };
    const { toSend, nextState } = decideWarnings({ breaches: {}, state, now: NOW, today: TODAY });
    expect(toSend).toEqual([]);
    expect(nextState).toEqual(state);
  });

  test('does not mutate the input state', () => {
    const state = { a: prior('2026-11-05', 10000) };
    const snapshot = JSON.parse(JSON.stringify(state));
    decideWarnings({ breaches: { a: null }, state, now: NOW, today: TODAY });
    expect(state).toEqual(snapshot);
  });

  describe('already below / continuous breach', () => {
    const run = (stateEntry, breach) =>
      decideWarnings({ breaches: { a: breach }, state: stateEntry ? { a: stateEntry } : {}, now: NOW, today: TODAY });

    test('sent yesterday while already below, same shortfall, is quiet', () => {
      const r = run(prior('2026-10-29', 10000), { date: '2026-10-30', shortfallCents: 10000 });
      expect(r.toSend).toEqual([]);
      expect(r.nextState.a).toEqual(prior('2026-10-29', 10000));
    });

    test('same but shortfall changed past the threshold sends', () => {
      const r = run(prior('2026-10-29', 10000), { date: '2026-10-30', shortfallCents: 13000 });
      expect(r.toSend).toEqual(['a']);
      expect(r.nextState.a).toEqual({ firstDate: '2026-10-30', shortfallCents: 13000, sentAt: NOW.toISOString() });
    });

    test('a future crossing that has now arrived is quiet', () => {
      const r = decideWarnings({
        breaches: { a: { date: '2026-11-13', shortfallCents: 10000 } },
        state: { a: prior('2026-11-13', 10000) },
        now: NOW,
        today: '2026-11-13',
      });
      expect(r.toSend).toEqual([]);
    });

    test('a crossing that moved earlier sends', () => {
      const r = run(prior('2026-11-13', 10000), { date: '2026-11-10', shortfallCents: 10000 });
      expect(r.toSend).toEqual(['a']);
    });

    test('cleared then breached again with a later date sends as new', () => {
      const cleared = run(prior('2026-10-29', 10000), null);
      const r = decideWarnings({
        breaches: { a: { date: '2026-11-20', shortfallCents: 10000 } },
        state: cleared.nextState,
        now: NOW,
        today: TODAY,
      });
      expect(r.toSend).toEqual(['a']);
    });
  });

  test('a decrease past the threshold sends, exactly at the boundary is quiet', () => {
    const state = { a: prior('2026-11-05', 10000) };
    const go = (cents) =>
      decideWarnings({ breaches: { a: { date: '2026-11-05', shortfallCents: cents } }, state, now: NOW, today: TODAY }).toSend;
    expect(go(7000)).toEqual(['a']);
    expect(go(12500)).toEqual([]);
  });

  test('undefined state is treated as empty', () => {
    const r = decideWarnings({ breaches: { a: { date: '2026-11-05', shortfallCents: 100 } }, now: NOW, today: TODAY });
    expect(r.toSend).toEqual(['a']);
  });
});
