import { describePickerError } from '../../src/widget-builder/picker-error';

test('returns null for a successful response', () => {
  expect(describePickerError({ ok: true, status: 200 })).toBeNull();
});

test('returns a message for a non-200 response', () => {
  expect(describePickerError({ ok: false, status: 401 })).toMatch(/401/);
});

test('returns a message for a network failure (null response)', () => {
  expect(describePickerError(null)).toMatch(/could not reach/i);
});
