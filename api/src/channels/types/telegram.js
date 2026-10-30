const { postJson, truncate } = require('../http');

module.exports = {
  type: 'telegram',
  label: 'Telegram',
  fields: [
    { key: 'botToken', label: 'Bot token', secret: true, required: true, kind: 'text' },
    { key: 'chatId', label: 'Chat ID', secret: false, required: true, kind: 'text' },
  ],
  async send(message, config, deps) {
    await postJson(deps, `https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      chat_id: config.chatId,
      text: truncate(message.text, 4096),
      disable_web_page_preview: true,
    });
  },
};
