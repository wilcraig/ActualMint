const { postJson, trimSlash } = require('../http');

module.exports = {
  type: 'gotify',
  label: 'Gotify',
  fields: [
    { key: 'server', label: 'Server URL', secret: false, required: true, kind: 'url' },
    { key: 'token', label: 'App token', secret: true, required: true, kind: 'text' },
  ],
  async send(message, config, deps) {
    // Token in a header, not the ?token= query, so it can't land in logs.
    await postJson(
      deps,
      `${trimSlash(config.server)}/message`,
      { title: message.title, message: message.text, priority: 5 },
      { headers: { 'X-Gotify-Key': config.token } },
    );
  },
};
