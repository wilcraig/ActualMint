const nodemailer = require('nodemailer');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = {
  type: 'email',
  label: 'Email (SMTP)',
  fields: [
    { key: 'host', label: 'SMTP host', secret: false, required: true, kind: 'text' },
    { key: 'port', label: 'Port', secret: false, required: true, kind: 'number', default: 587 },
    { key: 'security', label: 'Security', secret: false, required: true, kind: 'select', options: ['starttls', 'tls', 'none'], default: 'starttls' },
    { key: 'username', label: 'Username', secret: false, required: false, kind: 'text' },
    { key: 'password', label: 'Password', secret: true, required: false, kind: 'text' },
    { key: 'from', label: 'From address', secret: false, required: true, kind: 'text' },
    { key: 'to', label: 'To address', secret: false, required: true, kind: 'text' },
  ],
  presets: [
    {
      id: 'gmail',
      label: 'Gmail',
      values: { host: 'smtp.gmail.com', port: 587, security: 'starttls' },
      note: "Gmail needs an app password: Google Account → Security → 2-Step Verification → App passwords. Your normal password won't work.",
    },
  ],
  validate(config) {
    if (!EMAIL_PATTERN.test(config.from || '')) return 'From must be an email address';
    if (!EMAIL_PATTERN.test(config.to || '')) return 'To must be an email address';
    return null;
  },
  async send(message, config, deps) {
    const createTransport = deps.createTransport || nodemailer.createTransport;
    const security = config.security || 'starttls';
    const options = {
      host: config.host,
      port: Number(config.port) || 587,
      secure: security === 'tls',
      requireTLS: security === 'starttls',
      // Same 15s ceiling as the HTTP channels, applied to connect and each command.
      connectionTimeout: deps.timeoutMs ?? 15000,
      socketTimeout: deps.timeoutMs ?? 15000,
    };
    if (config.username || config.password) {
      options.auth = { user: config.username, pass: config.password };
    }
    const transport = createTransport(options);
    const mail = { from: config.from, to: config.to, subject: message.title, text: message.text };
    if (message.html) mail.html = message.html;
    await transport.sendMail(mail);
  },
};
