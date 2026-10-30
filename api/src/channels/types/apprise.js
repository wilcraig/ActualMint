const { postJson, trimSlash } = require('../http');

module.exports = {
  type: 'apprise',
  label: 'Apprise',
  fields: [
    { key: 'apiUrl', label: 'Apprise API URL', secret: false, required: true, kind: 'url' },
    { key: 'configKey', label: 'Config key (or use target URLs)', secret: true, required: false, kind: 'text' },
    { key: 'targets', label: 'Target URLs, comma-separated (or use a config key)', secret: true, required: false, kind: 'text' },
  ],
  validate(config) {
    if (!config.configKey && !config.targets) return 'Provide a config key or target URLs';
    return null;
  },
  async send(message, config, deps) {
    const body = { title: message.title, body: message.text, format: 'text' };
    const base = trimSlash(config.apiUrl);
    if (config.configKey) {
      await postJson(deps, `${base}/notify/${encodeURIComponent(config.configKey)}`, body);
    } else {
      await postJson(deps, `${base}/notify`, { ...body, urls: config.targets });
    }
  },
};
