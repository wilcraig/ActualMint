import { mountWidgetBuilderPanel } from '../../src/widget-builder/mount-toolbar';

function renderAddWidgetButton() {
  const button = document.createElement('button');
  button.textContent = 'Add new widget';
  document.body.appendChild(button);
  return button;
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/budget');
});

test('constructs the component exactly once, even across repeated Reports visits', () => {
  const constructorSpy = vi.fn();
  class FakePanel {
    constructor(opts) {
      constructorSpy(opts);
    }
  }

  renderAddWidgetButton();
  mountWidgetBuilderPanel(document, window, FakePanel);
  expect(constructorSpy).toHaveBeenCalledTimes(1);

  window.history.pushState({}, '', '/reports');
  window.history.pushState({}, '', '/budget');
  window.history.pushState({}, '', '/reports/custom');
  expect(constructorSpy).toHaveBeenCalledTimes(1);
});

test('container stays hidden off Reports, and attaches right after the Add new widget button on Reports', () => {
  const button = renderAddWidgetButton();
  class FakePanel {
    constructor() {}
  }

  mountWidgetBuilderPanel(document, window, FakePanel);
  const container = document.body.lastElementChild;
  expect(container.style.display).toBe('none');

  window.history.pushState({}, '', '/reports');
  expect(container.previousElementSibling).toBe(button);
  expect(container.style.display).toBe('inline-block');
});

test('navigating away hides the container without removing it from the document', () => {
  renderAddWidgetButton();
  class FakePanel {
    constructor() {}
  }

  mountWidgetBuilderPanel(document, window, FakePanel);
  const container = document.body.lastElementChild;

  window.history.pushState({}, '', '/reports');
  expect(container.isConnected).toBe(true);

  window.history.pushState({}, '', '/budget');
  expect(container.isConnected).toBe(true);
  expect(container.style.display).toBe('none');
});

test('keeps watching (no arbitrary timeout) until the Add new widget button appears, then attaches', async () => {
  class FakePanel {
    constructor() {}
  }

  mountWidgetBuilderPanel(document, window, FakePanel);
  const container = document.body.lastElementChild;

  window.history.pushState({}, '', '/reports');
  expect(container.style.display).toBe('none');

  await Promise.resolve();
  expect(container.previousElementSibling).toBeNull();

  // Simulate a slow-rendering toolbar (e.g. a real deployment's Actual
  // Budget Tweaks sidecar, confirmed live to take several seconds).
  const button = renderAddWidgetButton();
  // MutationObserver callbacks fire as a microtask, not synchronously.
  await Promise.resolve();
  await Promise.resolve();
  expect(container.previousElementSibling).toBe(button);
});
