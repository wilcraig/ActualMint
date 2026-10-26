import { pie as d3Pie } from 'd3';

// Pure slice-geometry helper for the category breakdown donut.
//
// Thin wrapper around d3.pie(): d3 already computes contiguous,
// proportional start/end angles (and handles the empty-input and
// all-zero-value edge cases without dividing by zero), so we reuse it
// rather than re-deriving the same angle math by hand. Keeping this
// function free of any DOM/SVG dependency (it only touches
// `d3-shape`, never `d3-selection` or the DOM) is what keeps it
// testable under plain Node/jsdom without jsdom's incomplete SVG
// geometry support. We only import d3's `pie` layout generator
// (pure math, no DOM), never `d3-selection` or anything that touches
// the DOM.
//
// Slice order: input-order (not largest-first). d3.pie() defaults to
// sorting by descending value; we disable that (`.sort(null)`) so the
// returned slices line up 1:1, in the same order, with the caller's
// input array — callers (e.g. a legend rendered alongside the donut)
// can zip the two arrays together without re-deriving a sort order.
export function computeSlices(slices) {
  if (!slices || slices.length === 0) {
    return [];
  }

  const total = slices.reduce((sum, slice) => sum + slice.amountCents, 0);

  const pieLayout = d3Pie()
    .value((slice) => slice.amountCents)
    .sort(null);

  const arcs = pieLayout(slices);

  return arcs.map((arc) => ({
    id: arc.data.id,
    label: arc.data.label,
    amountCents: arc.data.amountCents,
    startAngle: arc.startAngle,
    endAngle: arc.endAngle,
    pct: total === 0 ? 0 : Math.round((arc.data.amountCents / total) * 1000) / 10,
  }));
}
