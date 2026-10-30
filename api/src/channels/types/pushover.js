const { request, truncate } = require('../http');

module.exports = {
  type: 'pushover',
  label: 'Pushover',
  fields: [
    { key: 'appToken', label: 'App token', secret: true, required: true, kind: 'text' },
    { key: 'userKey', label: 'User key', secret: true, required: true, kind: 'text' },
  ],
  async send(message, config, deps) {
    const body = new URLSearchParams({
      token: config.appToken,
      user: config.userKey,
      title: message.title,
      message: truncate(message.text, 1024),
    });
    await request(deps, 'https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  },
};
