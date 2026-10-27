import { mountSettingsSection } from '../../src/settings-panel/mount-settings';

function renderThemesCard() {
  const stack = document.createElement('div');
  for (const name of ['Actual', 'Themes', 'Formatting', 'Language', 'Authentication']) {
    const card = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = name;
    card.appendChild(heading);
    stack.appendChild(card);
  }
  document.body.appendChild(stack);
  return stack.children[1]; // the "Themes" card
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/budget');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('constructs the component exactly once, even across repeated /settings visits', () => {
  const constructorSpy = vi.fn();
  class FakeSection {
    constructor(opts) {
      constructorSpy(opts);
    }
  }

  renderThemesCard();
  mountSettingsSection(document, window, FakeSection);
  expect(constructorSpy).toHaveBeenCalledTimes(1);

  window.history.pushState({}, '', '/settings');
  window.history.pushState({}, '', '/budget');
  window.history.pushState({}, '', '/settings');
  expect(constructorSpy).toHaveBeenCalledTimes(1);
});

test('container stays hidden off /settings, and attaches next to the Themes card on /settings', () => {
  const themesCard = renderThemesCard();
  class FakeSection {
    constructor() {}
  }

  mountSettingsSection(document, window, FakeSection);
  const container = document.body.lastElementChild;
  expect(container.style.display).toBe('none');

  window.history.pushState({}, '', '/settings');
  expect(container.previousElementSibling).toBe(themesCard);
  expect(container.style.display).not.toBe('none');
});

test('navigating away hides the container without removing it from the document', () => {
  renderThemesCard();
  class FakeSection {
    constructor() {}
  }

  mountSettingsSection(document, window, FakeSection);
  const container = document.body.lastElementChild;

  window.history.pushState({}, '', '/settings');
  expect(container.isConnected).toBe(true);

  window.history.pushState({}, '', '/budget');
  expect(container.isConnected).toBe(true);
  expect(container.style.display).toBe('none');
});

test('retries on a short interval until the Themes card appears, then attaches', () => {
  class FakeSection {
    constructor() {}
  }

  mountSettingsSection(document, window, FakeSection);
  const container = document.body.lastElementChild;

  window.history.pushState({}, '', '/settings');
  expect(container.style.display).toBe('none');

  // No Themes card yet -- several retries pass with no attach.
  vi.advanceTimersByTime(300);
  expect(container.isConnected).toBe(true);
  expect(container.previousElementSibling).toBeNull();

  const themesCard = renderThemesCard();
  vi.advanceTimersByTime(100);
  expect(container.previousElementSibling).toBe(themesCard);
});

test('copies the Themes card\'s own border/background/padding onto the container', () => {
  const themesCard = renderThemesCard();
  themesCard.style.paddingTop = '15px';
  themesCard.style.paddingRight = '15px';
  themesCard.style.paddingBottom = '15px';
  themesCard.style.paddingLeft = '15px';
  themesCard.style.borderTopLeftRadius = '4px';
  themesCard.style.width = '375px';
  class FakeSection {
    constructor() {}
  }

  mountSettingsSection(document, window, FakeSection);
  // Must be captured before the attach -- once attached, the container is
  // re-parented as a sibling of the Themes card (inside the card stack),
  // no longer `document.body`'s last child.
  const container = document.body.lastElementChild;
  window.history.pushState({}, '', '/settings');

  expect(container.style.paddingTop).toBe('15px');
  expect(container.style.borderRadius).toBe('4px');
  expect(container.style.width).toBe('375px');
});
