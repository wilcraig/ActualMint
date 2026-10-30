const { request, trimSlash } = require('../http');

module.exports = {
  type: 'ntfy',
  label: 'ntfy',
  fields: [
    { key: 'server', label: 'Server URL', secret: false, required: true, kind: 'url', default: 'https://ntfy.sh' },
    { key: 'topic', label: 'Topic', secret: true, required: true, kind: 'text' },
    { key: 'token', label: 'Access token (optional)', secret: true, required: false, kind: 'text' },
    { key: 'priority', label: 'Priority', secret: false, required: false, kind: 'select', options: ['1', '2', '3', '4', '5'], default: '3' },
  ],
  async send(message, config, deps) {
    const headers = {
      Title: message.title,
      Priority: String(config.priority || 3),
    };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;

    let body = message.text;
    if (message.markdown) {
      body = message.markdown;
      headers.Markdown = 'yes';
    }
    await request(deps, `${trimSlash(config.server)}/${encodeURIComponent(config.topic)}`, {
      method: 'POST',
      headers,
      body,
    });
  },
};
