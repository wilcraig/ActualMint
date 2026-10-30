const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { defaultSettings, readSettings, writeSettings, validateSettings } = require('../src/forecast/settings-store');

let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forecast-settings-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const valid = () => ({
  enabled: true,
  windowDays: 15,
  time: '07:00',
  channelId: 'c1',
  accounts: { a1: { enabled: true, warningLevelCents: 0 } },
});

describe('defaults and persistence', () => {
  test('defaults', () => {
    expect(defaultSettings()).toEqual({ enabled: false, windowDays: 15, time: '07:00', channelId: null, accounts: {} });
  });

  test('missing file returns defaults', async () => {
    expect(await readSettings(dir)).toEqual(defaultSettings());
  });

  test('write then read round-trips', async () => {
    await writeSettings(valid(), dir);
    expect(await readSettings(dir)).toEqual(valid());
  });

  test('stored settings are merged over defaults', async () => {
    await fs.writeFile(path.join(dir, 'forecast-settings.json'), JSON.stringify({ enabled: true }));
    expect(await readSettings(dir)).toEqual({ ...defaultSettings(), enabled: true });
  });

  test('a corrupt file throws', async () => {
    await fs.writeFile(path.join(dir, 'forecast-settings.json'), '{nope');
    await expect(readSettings(dir)).rejects.toThrow();
  });
});

describe('validateSettings', () => {
  test('accepts valid settings, including the limits', () => {
    expect(validateSettings(valid())).toEqual({ ok: true, settings: valid() });
    expect(validateSettings({ ...valid(), windowDays: 30, time: '23:59' }).ok).toBe(true);
  });

  test.each([0, 31])('rejects windowDays %s', (windowDays) => {
    expect(validateSettings({ ...valid(), windowDays })).toMatchObject({ ok: false, field: 'windowDays' });
  });

  test.each(['7:00', '24:00'])('rejects time %s', (time) => {
    expect(validateSettings({ ...valid(), time })).toMatchObject({ ok: false, field: 'time' });
  });

  test.each([-1, 1.5])('rejects warningLevelCents %s', (warningLevelCents) => {
    const input = { ...valid(), accounts: { a1: { enabled: true, warningLevelCents } } };
    expect(validateSettings(input)).toMatchObject({ ok: false, field: 'accounts.a1.warningLevelCents' });
  });

  test('rejects a non-boolean enabled', () => {
    expect(validateSettings({ ...valid(), enabled: 'yes' })).toMatchObject({ ok: false, field: 'enabled' });
  });

  test('drops unknown top-level and account keys', () => {
    const input = { ...valid(), extra: 1, accounts: { a1: { enabled: true, warningLevelCents: 5, junk: true } } };
    expect(validateSettings(input).settings).toEqual({
      ...valid(),
      accounts: { a1: { enabled: true, warningLevelCents: 5 } },
    });
  });
});
