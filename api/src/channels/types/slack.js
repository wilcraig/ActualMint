const { postJson } = require('../http');

module.exports = {
  type: 'slack',
  label: 'Slack',
  fields: [{ key: 'url', label: 'Incoming webhook URL', secret: true, required: true, kind: 'url' }],
  async send(message, config, deps) {
    await postJson(deps, config.url, { text: message.markdown || message.text });
  },
};
