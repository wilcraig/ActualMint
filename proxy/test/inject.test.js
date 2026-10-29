const { injectTags } = require('../src/inject');

test('inserts tags before the last </body>', () => {
  const html = '<html><body><p>hi</p></body></html>';
  const out = injectTags(html, '<script src="/insights/bundle.js"></script>');
  expect(out).toBe(
    '<html><body><p>hi</p><script src="/insights/bundle.js"></script></body></html>'
  );
});

test('returns html unchanged when no </body> is present', () => {
  const html = '<html><body><p>no closing tag';
  expect(injectTags(html, '<script></script>')).toBe(html);
});
