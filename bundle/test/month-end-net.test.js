import { netSignClass } from '../src/widgets/month-end-net-data';

test('a positive projected net is classed positive', () => {
  expect(netSignClass(15000)).toBe('positive');
});

test('a negative projected net is classed negative', () => {
  expect(netSignClass(-15000)).toBe('negative');
});

test('an exactly-zero projected net is classed zero (neither color)', () => {
  expect(netSignClass(0)).toBe('zero');
});
