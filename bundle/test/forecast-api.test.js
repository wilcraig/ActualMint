vi.mock('../src/api-client', () => ({ fetchApi: vi.fn() }));

import { fetchApi } from '../src/api-client';
import {
  getSettings,
  saveSettings,
  checkNow,
  sendTestMessage,
  getHistory,
  ForecastApiError,
} from '../src/insights-page/forecast-api';

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  fetchApi.mockReset();
});

test('getSettings GETs /api/forecast/settings', async () => {
  const body = { settings: { enabled: true }, accounts: [{ id: 'a', name: 'Checking', balanceCents: 100 }], timezone: 'UTC' };
  fetchApi.mockResolvedValue(ok(body));
  expect(await getSettings()).toEqual(body);
  expect(fetchApi).toHaveBeenCalledWith('/api/forecast/settings', undefined);
});

test('saveSettings PUTs the whole settings as JSON', async () => {
  const settings = { enabled: true, channelId: 'c1' };
  fetchApi.mockResolvedValue(ok({ settings }));
  expect(await saveSettings(settings)).toEqual({ settings });
  const [path, options] = fetchApi.mock.calls[0];
  expect(path).toBe('/api/forecast/settings');
  expect(options.method).toBe('PUT');
  expect(options.headers['Content-Type']).toBe('application/json');
  expect(JSON.parse(options.body)).toEqual(settings);
});

test('checkNow POSTs /api/forecast/check', async () => {
  fetchApi.mockResolvedValue(ok({ forecast: { warn: false } }));
  expect(await checkNow()).toEqual({ forecast: { warn: false } });
  const [path, options] = fetchApi.mock.calls[0];
  expect(path).toBe('/api/forecast/check');
  expect(options.method).toBe('POST');
  expect(JSON.parse(options.body)).toEqual({});
});

test('sendTestMessage POSTs /api/forecast/test', async () => {
  fetchApi.mockResolvedValue(ok({ ok: false, error: 'nope' }));
  expect(await sendTestMessage()).toEqual({ ok: false, error: 'nope' });
  const [path, options] = fetchApi.mock.calls[0];
  expect(path).toBe('/api/forecast/test');
  expect(options.method).toBe('POST');
});

test('getHistory GETs /api/forecast/history', async () => {
  fetchApi.mockResolvedValue(ok({ history: [] }));
  expect(await getHistory()).toEqual({ history: [] });
  expect(fetchApi).toHaveBeenCalledWith('/api/forecast/history', undefined);
});

test('a non-ok response throws ForecastApiError with error and field', async () => {
  fetchApi.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Bad time', field: 'times[0]' }) });
  const err = await saveSettings({}).catch((e) => e);
  expect(err).toBeInstanceOf(ForecastApiError);
  expect(err.message).toBe('Bad time');
  expect(err.field).toBe('times[0]');
});

test('a non-JSON error body falls back to the status, field null', async () => {
  fetchApi.mockResolvedValue({
    ok: false,
    status: 502,
    json: async () => {
      throw new Error('not json');
    },
  });
  const err = await getHistory().catch((e) => e);
  expect(err).toBeInstanceOf(ForecastApiError);
  expect(err.message).toBe('Request failed (502)');
  expect(err.field).toBeNull();
});

test('an unreachable API throws "Could not reach insights-api."', async () => {
  fetchApi.mockRejectedValue(new TypeError('network'));
  const err = await getSettings().catch((e) => e);
  expect(err).toBeInstanceOf(ForecastApiError);
  expect(err.message).toBe('Could not reach insights-api.');
});
