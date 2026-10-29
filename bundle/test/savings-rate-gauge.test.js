vi.mock('../src/api-client', () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from '../src/api-client';
import SavingsRateGauge from '../src/widgets/SavingsRateGauge.svelte';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function mountWidget(props = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new SavingsRateGauge({ target, props });
  return target;
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  fetchApi.mockReset();
});

function expectedCurrentMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

test('fetches the current month with the configured investmentGroupIds', async () => {
  fetchApi.mockResolvedValue(
    jsonResponse({ incomeCents: 500000, outflowCents: 300000, investmentCents: 50000, rate: 0.5 })
  );

  mountWidget({ investmentGroupIds: ['group1', 'group2'] });
  await flush();

  expect(fetchApi).toHaveBeenCalledTimes(1);
  const [path] = fetchApi.mock.calls[0];
  const [base, query] = path.split('?');
  expect(base).toBe('/api/savings-rate');
  const params = new URLSearchParams(query);
  expect(params.get('month')).toBe(expectedCurrentMonth());
  expect(params.get('investmentGroupIds')).toBe('group1,group2');
});

test('renders a semi-circle gauge filled to the rate percentage', async () => {
  fetchApi.mockResolvedValue(
    jsonResponse({ incomeCents: 500000, outflowCents: 300000, investmentCents: 50000, rate: 0.5 })
  );

  const target = mountWidget();
  await flush();

  expect(target.textContent).toContain('50%');
  const arcPath = target.querySelector('.gauge-fill-arc');
  expect(arcPath).not.toBeNull();
  expect(arcPath.getAttribute('d')).toBeTruthy();
  const svg = target.querySelector('svg.gauge-svg');
  expect(svg).not.toBeNull();
});

test('rate: null (zero income) shows a "no income this month" message instead of a bogus percentage', async () => {
  fetchApi.mockResolvedValue(
    jsonResponse({ incomeCents: 0, outflowCents: 0, investmentCents: 0, rate: null })
  );

  const target = mountWidget();
  await flush();

  expect(target.textContent.toLowerCase()).toContain('no income this month');
  expect(target.textContent).not.toContain('%');
  expect(target.querySelector('.gauge-fill-arc')).toBeNull();
});

test("colors along red/amber/green by rate (exact thresholds are this task's own call, documented in a comment, not configurable)", async () => {
  async function rateColor(rate) {
    fetchApi.mockResolvedValue(
      jsonResponse({ incomeCents: 100000, outflowCents: 0, investmentCents: 0, rate })
    );
    const target = mountWidget();
    await flush();
    return target.querySelector('.gauge-fill-arc').getAttribute('fill');
  }

  const red = await rateColor(-0.1);
  const amber = await rateColor(0.1);
  const green = await rateColor(0.3);

  expect(red).not.toBe(amber);
  expect(amber).not.toBe(green);
  expect(red).not.toBe(green);
});

test('fill geometry clamps to [0, 1] while the displayed percentage shows the raw rate', async () => {
  async function renderRate(rate) {
    fetchApi.mockResolvedValue(
      jsonResponse({ incomeCents: 100000, outflowCents: 0, investmentCents: 0, rate })
    );
    const target = mountWidget();
    await flush();
    return {
      arcD: target.querySelector('.gauge-fill-arc').getAttribute('d'),
      pctLabel: target.querySelector('.gauge-pct-label').textContent,
    };
  }

  const belowRange = await renderRate(-0.1);
  const atZero = await renderRate(0);
  const aboveRange = await renderRate(1.4);
  const atFull = await renderRate(1.0);

  // A negative rate's fill arc must be geometrically identical to a 0%
  // arc (clamped), not swept backwards past the semicircle's start.
  expect(belowRange.arcD).toBe(atZero.arcD);
  // A >100% rate's fill arc must be geometrically identical to a 100%
  // arc (clamped), not swept past the semicircle's end.
  expect(aboveRange.arcD).toBe(atFull.arcD);

  // The displayed percentage is never clamped -- it always reflects the
  // raw rate, even when the visual fill is capped at the ends.
  expect(belowRange.pctLabel).toBe('-10%');
  expect(aboveRange.pctLabel).toBe('140%');
});

test('renders the inline error treatment on a non-ok response', async () => {
  fetchApi.mockResolvedValue(jsonResponse(null, false, 500));

  const target = mountWidget();
  await flush();

  expect(target.textContent).toContain('Savings rate unavailable (500)');
});

test('renders the inline error treatment when fetch throws', async () => {
  fetchApi.mockRejectedValue(new Error('network down'));

  const target = mountWidget();
  await flush();

  expect(target.textContent).toContain('could not reach insights-api');
});
