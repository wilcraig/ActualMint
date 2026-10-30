const { postJson, trimSlash } = require('../http');

module.exports = {
  type: 'homeassistant',
  label: 'Home Assistant',
  fields: [
    { key: 'baseUrl', label: 'Base URL', secret: false, required: true, kind: 'url' },
    { key: 'webhookId', label: 'Webhook ID', secret: true, required: true, kind: 'text' },
  ],
  async send(message, config, deps) {
    const { title, text, markdown, data } = message;
    await postJson(
      deps,
      `${trimSlash(config.baseUrl)}/api/webhook/${encodeURIComponent(config.webhookId)}`,
      { title, text, markdown, data },
    );
  },
};
