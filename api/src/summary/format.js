// Readable money for summary lines: integer cents in, '$1,234.56' out,
// negatives as '-$812.00'. Summaries are plain text first, so this never
// depends on the server's locale.
function formatMoney(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

module.exports = { formatMoney };
