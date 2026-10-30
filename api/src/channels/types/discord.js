const { postJson, truncate } = require('../http');

module.exports = {
  type: 'discord',
  label: 'Discord',
  fields: [{ key: 'url', label: 'Webhook URL', secret: true, required: true, kind: 'url' }],
  async send(message, config, deps) {
    await postJson(deps, config.url, { content: truncate(message.markdown || message.text, 2000) });
  },
};
