// Inclusive [start, end] filter on transactions.date, as a spreadable AQL
// filter fragment. Actual's AQL silently applies only the FIRST operator
// when one field carries two (`date: { $gte: a, $lte: b }` is just
// `$gte: a`), so the bounds have to be separate clauses under $and.
function dateRange(start, end) {
  return { $and: [{ date: { $gte: start } }, { date: { $lte: end } }] };
}

module.exports = { dateRange };
