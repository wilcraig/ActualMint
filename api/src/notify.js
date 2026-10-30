const { readChannels } = require('./channels/store');
const { CHANNEL_TYPES } = require('./channels/registry');
const { secretValues, scrubSecrets } = require('./channels/scrub');

// The one function the rest of the app calls to send something.
// message: { title, text, markdown?, html?, data? }. Never throws: failures
// come back as { ok: false, error }, with every stored secret scrubbed out
// of the text so it is safe to log or store.
async function notify(channelId, message, { dataDir, fetchImpl, createTransport, timeoutMs } = {}) {
  let secrets = [];
  try {
    const channels = await readChannels(dataDir);
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) return { ok: false, error: 'channel not found' };

    const channelType = CHANNEL_TYPES[channel.type];
    if (!channelType) return { ok: false, error: `unknown channel type: ${channel.type}` };

    secrets = secretValues(channel.type, channel.config);
    await channelType.send(message, channel.config || {}, { fetchImpl, createTransport, timeoutMs });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: scrubSecrets((err && err.message) || String(err), secrets) };
  }
}

module.exports = { notify };
