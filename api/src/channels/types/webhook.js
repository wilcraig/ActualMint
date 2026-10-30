const { postJson } = require('../http');

module.exports = {
  type: 'webhook',
  label: 'Webhook',
  fields: [
    { key: 'url', label: 'URL', secret: true, required: true, kind: 'url' },
    { key: 'method', label: 'Method', secret: false, required: false, kind: 'select', options: ['POST', 'PUT'], default: 'POST' },
    { key: 'headers', label: 'Custom headers', secret: true, required: false, kind: 'headers' },
  ],
  async send(message, config, deps) {
    const headers = {};
    for (const header of config.headers || []) {
      if (header && header.name) headers[header.name] = header.value ?? '';
    }
    const { title, text, markdown, html, data } = message;
    await postJson(deps, config.url, { title, text, markdown, html, data }, {
      method: config.method || 'POST',
      headers,
    });
  },
};
