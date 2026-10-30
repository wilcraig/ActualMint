const { ensureOk } = require('./http');

// type id -> ChannelType:
//   { type, label, fields, presets?, validate?(config) -> string | null,
//     send(message, config, deps) -> Promise<void> }
// `send` throws on failure; notify.js turns that into a result.
// fields: [{ key, label, secret, required, kind: 'text'|'url'|'number'|
//   'select'|'headers', options?, default? }]
// Types register themselves below, so a new channel is one file plus one line.
const CHANNEL_TYPES = {};

function register(channelType) {
  CHANNEL_TYPES[channelType.type] = channelType;
}

// What the UI needs to draw a form: everything except the functions.
function listChannelTypes() {
  return Object.values(CHANNEL_TYPES).map(({ type, label, fields, presets }) => {
    const entry = { type, label, fields };
    if (presets) entry.presets = presets;
    return entry;
  });
}

[
  require('./types/ntfy'),
  require('./types/email'),
  require('./types/webhook'),
  require('./types/discord'),
  require('./types/slack'),
  require('./types/telegram'),
  require('./types/pushover'),
  require('./types/gotify'),
  require('./types/homeassistant'),
  require('./types/apprise'),
].forEach(register);

module.exports = { CHANNEL_TYPES, listChannelTypes, register, ensureOk };
