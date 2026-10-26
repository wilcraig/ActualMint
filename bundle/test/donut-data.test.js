import { computeSlices } from '../src/widgets/donut-data';

test('computes proportional angles summing to a full circle', () => {
  const result = computeSlices([{ id: 'a', label: 'A', amountCents: 300 }, { id: 'b', label: 'B', amountCents: 100 }]);
  expect(result[0]).toMatchObject({ id: 'a', pct: 75 });
  expect(result[1]).toMatchObject({ id: 'b', pct: 25 });
  expect(result[1].endAngle).toBeCloseTo(2 * Math.PI, 5);
});

test('an empty slices array returns an empty array, no divide-by-zero', () => {
  expect(computeSlices([])).toEqual([]);
});

test('angles start at zero and are contiguous', () => {
  const result = computeSlices([
    { id: 'a', label: 'A', amountCents: 300 },
    { id: 'b', label: 'B', amountCents: 100 },
  ]);
  expect(result[0].startAngle).toBeCloseTo(0, 5);
  expect(result[0].endAngle).toBeCloseTo(result[1].startAngle, 5);
});

test('rounds pct to one decimal place', () => {
  const result = computeSlices([
    { id: 'a', label: 'A', amountCents: 1 },
    { id: 'b', label: 'B', amountCents: 2 },
  ]);
  expect(result[0].pct).toBeCloseTo(33.3, 5);
  expect(result[1].pct).toBeCloseTo(66.7, 5);
});

test('a single slice spans the full circle', () => {
  const result = computeSlices([{ id: 'a', label: 'A', amountCents: 500 }]);
  expect(result[0].startAngle).toBeCloseTo(0, 5);
  expect(result[0].endAngle).toBeCloseTo(2 * Math.PI, 5);
  expect(result[0].pct).toBe(100);
});
