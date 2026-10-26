// Inserts `tags` immediately before the last `</body>` in `html`.
// If there is no `</body>`, returns `html` unchanged.
function injectTags(html, tags) {
  const index = html.lastIndexOf('</body>');
  if (index === -1) return html;
  return html.slice(0, index) + tags + html.slice(index);
}

module.exports = { injectTags };
