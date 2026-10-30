// The section registry. Order here is the order sections appear in every
// summary and in the Summaries tab. A section is
// { id, title, build(ctx) -> Promise<{ data, lines } | null> }, where null
// means "nothing to report" and the builder leaves the section out. Its
// settings live in settings.sections[id] (see settings-store.js).
// To add a section (the data health panel, say), write its module, add it
// here, and give it defaults in settings-store.js.
const pacing = require('./pacing');
const largest = require('./largest');
const upcoming = require('./upcoming');
const watched = require('./watched');
const alerts = require('./alerts');

const SECTIONS = [pacing, largest, upcoming, watched, alerts];

function getSection(id) {
  return SECTIONS.find((section) => section.id === id);
}

module.exports = { SECTIONS, getSection };
