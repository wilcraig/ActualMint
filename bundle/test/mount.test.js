import { findPlaceholder, mountWidget } from '../src/mount';

test('finds and parses a placeholder with valid JSON config', () => {
  document.body.innerHTML = '<div id="host">{{ACTUALMINT:pacing-bars:["catA","catB"]}}</div>';
  const result = findPlaceholder('{{ACTUALMINT:pacing-bars:');
  expect(result).not.toBeNull();
  expect(result.config).toEqual(['catA', 'catB']);
  expect(result.node).toBe(document.getElementById('host'));
});

test('returns null when no placeholder is present', () => {
  document.body.innerHTML = '<div>nothing here</div>';
  expect(findPlaceholder('{{ACTUALMINT:pacing-bars:')).toBeNull();
});

test('a throwing render callback is caught and does not propagate', () => {
  document.body.innerHTML = '<div>{{ACTUALMINT:pacing-bars:[]}}</div>';
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  expect(() => {
    mountWidget('{{ACTUALMINT:pacing-bars:', () => { throw new Error('boom'); });
  }).not.toThrow();

  expect(consoleError).toHaveBeenCalled();
});
