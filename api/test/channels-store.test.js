const fs = require('fs/promises');
const path = require('path');
const os = require('os');

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'channels-store-test-'));
}

test('readChannels returns an empty array when channels.json does not exist yet', async () => {
  const dir = await tmpDir();
  const { readChannels } = require('../src/channels/store');
  expect(await readChannels(dir)).toEqual([]);
});

test('writeChannels then readChannels round-trips the exact list', async () => {
  const dir = await tmpDir();
  const { readChannels, writeChannels } = require('../src/channels/store');
  const channels = [{ id: 'c1', name: 'Phone', type: 'ntfy', config: { server: 'https://ntfy.example.test', topic: 'demo-topic' } }];
  await writeChannels(channels, dir);
  expect(await readChannels(dir)).toEqual(channels);
});

test('channels.json is owner-only (mode 0600) and no temp file is left behind', async () => {
  const dir = await tmpDir();
  const { writeChannels } = require('../src/channels/store');
  await writeChannels([{ id: 'c1', name: 'x', type: 'ntfy', config: {} }], dir);
  const stat = await fs.stat(path.join(dir, 'channels.json'));
  expect(stat.mode & 0o777).toBe(0o600);
  expect(await fs.readdir(dir)).toEqual(['channels.json']);
});

test('a corrupt channels.json rejects instead of resetting to empty', async () => {
  const dir = await tmpDir();
  await fs.writeFile(path.join(dir, 'channels.json'), '{not json');
  const { readChannels } = require('../src/channels/store');
  await expect(readChannels(dir)).rejects.toThrow();
});
