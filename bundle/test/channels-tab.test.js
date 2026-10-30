vi.mock('../src/insights-page/channels-api', async (importOriginal) => ({
  ...(await importOriginal()),
  listChannels: vi.fn(),
  createChannel: vi.fn(),
  updateChannel: vi.fn(),
  deleteChannel: vi.fn(),
  testChannel: vi.fn(),
}));

import { listChannels, createChannel, updateChannel, deleteChannel, testChannel, ChannelsApiError } from '../src/insights-page/channels-api';
import ChannelsTab from '../src/insights-page/ChannelsTab.svelte';

const TYPES = [
  {
    type: 'ntfy',
    label: 'ntfy',
    fields: [
      { key: 'server', label: 'Server URL', secret: false, required: true, kind: 'url', default: 'https://ntfy.sh' },
      { key: 'topic', label: 'Topic', secret: true, required: true, kind: 'text' },
    ],
  },
  {
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
      { id: 'gmail', label: 'Gmail', values: { host: 'smtp.gmail.com', port: 587, security: 'starttls' }, note: 'Gmail needs an app password: nope.' },
    ],
  },
  {
    type: 'webhook',
    label: 'Webhook',
    fields: [
      { key: 'url', label: 'URL', secret: true, required: true, kind: 'url' },
      { key: 'headers', label: 'Custom headers', secret: true, required: false, kind: 'headers' },
    ],
  },
];

const CHANNELS = [
  { id: 'c1', name: 'Phone', type: 'ntfy', config: { server: 'https://ntfy.example.test' }, secretsSet: ['topic'] },
  { id: 'c2', name: 'Agent', type: 'webhook', config: { headers: [{ name: 'X-Auth' }] }, secretsSet: ['url', 'headers'] },
];

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mountTab() {
  document.body.innerHTML = '<div id="host"></div>';
  new ChannelsTab({ target: document.getElementById('host') });
  await flush();
  return document.getElementById('host');
}

function type(el, value) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function click(el) {
  el.click();
  await flush();
}

beforeEach(() => {
  listChannels.mockReset();
  listChannels.mockResolvedValue({ channels: CHANNELS, types: TYPES });
  createChannel.mockReset();
  createChannel.mockResolvedValue({});
  updateChannel.mockReset();
  updateChannel.mockResolvedValue({});
  deleteChannel.mockReset();
  testChannel.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

test('lists each channel with its name and type label', async () => {
  const host = await mountTab();
  const rows = host.querySelectorAll('.channel-row');
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain('Phone');
  expect(rows[0].textContent).toContain('ntfy');
  expect(rows[1].textContent).toContain('Webhook');
});

test('choosing Email shows the host, port, security, username, password, from and to fields', async () => {
  const host = await mountTab();
  await click(host.querySelector('.add-channel-button'));
  const select = host.querySelector('#channel-type');
  select.value = 'email';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();

  for (const key of ['host', 'port', 'security', 'username', 'password', 'from', 'to']) {
    expect(host.querySelector(`#channel-field-${key}`), key).not.toBeNull();
  }
  expect(host.querySelector('#channel-field-password').type).toBe('password');
  expect(host.querySelector('#channel-field-port').value).toBe('587');
  expect(host.querySelector('#channel-field-security').value).toBe('starttls');
});

test('the Gmail preset fills host, port and security and shows the app-password note', async () => {
  const host = await mountTab();
  await click(host.querySelector('.add-channel-button'));
  const select = host.querySelector('#channel-type');
  select.value = 'email';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
  const security = host.querySelector('#channel-field-security');
  security.value = 'none';
  security.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();

  await click(host.querySelector('#channel-preset-gmail'));

  expect(host.querySelector('#channel-field-host').value).toBe('smtp.gmail.com');
  expect(host.querySelector('#channel-field-port').value).toBe('587');
  expect(host.querySelector('#channel-field-security').value).toBe('starttls');
  expect(host.querySelector('.preset-note').textContent).toContain('app password');
});

test('saving a new channel posts name, type and typed config', async () => {
  const host = await mountTab();
  await click(host.querySelector('.add-channel-button'));
  type(host.querySelector('#channel-name'), 'Pager');
  type(host.querySelector('#channel-field-topic'), 'demo-topic');
  await click(host.querySelector('.save-button'));

  expect(createChannel).toHaveBeenCalledWith({
    name: 'Pager',
    type: 'ntfy',
    config: { server: 'https://ntfy.sh', topic: 'demo-topic' },
  });
});

test('editing leaves a stored secret blank and submits config without that key', async () => {
  const host = await mountTab();
  await click(host.querySelector('[data-channel-id="c1"] .edit-button'));

  const topic = host.querySelector('#channel-field-topic');
  expect(topic.value).toBe('');
  expect(topic.placeholder).toContain('leave blank to keep');
  expect(host.querySelector('#channel-type').disabled).toBe(true);

  type(host.querySelector('#channel-field-server'), 'https://ntfy2.example.test');
  await click(host.querySelector('.save-button'));

  expect(updateChannel).toHaveBeenCalledWith('c1', { name: 'Phone', config: { server: 'https://ntfy2.example.test' } });
});

test('typing a new secret on edit sends it', async () => {
  const host = await mountTab();
  await click(host.querySelector('[data-channel-id="c1"] .edit-button'));
  type(host.querySelector('#channel-field-topic'), 'fresh-topic');
  await click(host.querySelector('.save-button'));
  expect(updateChannel.mock.calls[0][1].config.topic).toBe('fresh-topic');
});

test('header rows: existing ones keep their value unless retyped, new ones can be added and removed', async () => {
  const host = await mountTab();
  await click(host.querySelector('[data-channel-id="c2"] .edit-button'));

  const pairs = () => host.querySelectorAll('.header-pair');
  expect(pairs()).toHaveLength(1);
  expect(host.querySelector('.header-value').placeholder).toContain('leave blank to keep');

  await click(host.querySelector('.header-add'));
  expect(pairs()).toHaveLength(2);
  type(pairs()[1].querySelector('.header-name'), 'X-Extra');
  type(pairs()[1].querySelector('.header-value'), 'v2');
  await click(host.querySelector('.save-button'));

  expect(updateChannel).toHaveBeenCalledWith('c2', {
    name: 'Agent',
    config: { headers: [{ name: 'X-Auth' }, { name: 'X-Extra', value: 'v2' }] },
  });

  await click(host.querySelector('[data-channel-id="c2"] .edit-button'));
  await click(host.querySelector('.header-remove'));
  expect(pairs()).toHaveLength(0);
});

test('an API validation error is shown next to the named field and the form stays open', async () => {
  createChannel.mockRejectedValue(new ChannelsApiError('Server URL must be a valid URL', 'server'));
  const host = await mountTab();
  await click(host.querySelector('.add-channel-button'));
  type(host.querySelector('#channel-name'), 'Pager');
  type(host.querySelector('#channel-field-topic'), 't');
  await click(host.querySelector('.save-button'));

  expect(host.querySelector('.field-error').textContent).toBe('Server URL must be a valid URL');
  expect(host.querySelector('#channel-field-server').classList.contains('has-error')).toBe(true);
  expect(host.querySelector('.channel-form')).not.toBeNull();
});

test('Send test shows a check on success and the returned error on failure', async () => {
  const host = await mountTab();
  testChannel.mockResolvedValueOnce({ ok: true });
  await click(host.querySelector('[data-channel-id="c1"] .test-button'));
  expect(testChannel).toHaveBeenCalledWith('c1');
  expect(host.querySelector('[data-channel-id="c1"] .test-result').textContent).toContain('✓');

  testChannel.mockResolvedValueOnce({ ok: false, error: 'HTTP 401: unauthorized' });
  await click(host.querySelector('[data-channel-id="c1"] .test-button'));
  expect(host.querySelector('[data-channel-id="c1"] .test-result').textContent).toContain('HTTP 401: unauthorized');
});

test('Delete asks for confirmation, then removes the row', async () => {
  deleteChannel.mockResolvedValue(null);
  const host = await mountTab();

  window.confirm.mockReturnValueOnce(false);
  await click(host.querySelector('[data-channel-id="c1"] .delete-button'));
  expect(deleteChannel).not.toHaveBeenCalled();

  await click(host.querySelector('[data-channel-id="c1"] .delete-button'));
  expect(deleteChannel).toHaveBeenCalledWith('c1');
  expect(host.querySelector('[data-channel-id="c1"]')).toBeNull();
});

test('a load failure shows an inline error', async () => {
  listChannels.mockRejectedValue(new ChannelsApiError('Could not reach insights-api.'));
  const host = await mountTab();
  expect(host.textContent).toContain('Channels unavailable: Could not reach insights-api.');
});
