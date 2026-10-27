import { isSettingsPath, findThemesCard } from '../../src/settings-panel/settings-anchor';

describe('isSettingsPath', () => {
  test('true only for exactly /settings', () => {
    expect(isSettingsPath('/settings')).toBe(true);
    expect(isSettingsPath('/settings/advanced')).toBe(false);
    expect(isSettingsPath('/budget')).toBe(false);
  });
});

describe('findThemesCard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function renderSettingsStack() {
    // Mirrors the real structure confirmed by live inspection: a 10-child
    // card stack, each card a div wrapping a description span (containing
    // a bold heading) plus its controls.
    const stack = document.createElement('div');
    const cardNames = [
      'Actual', 'Themes', 'Formatting', 'Language', 'Authentication',
      'Encryption', 'Budgeting', 'Export', 'Advanced', 'Danger zone',
    ];
    for (const name of cardNames) {
      const card = document.createElement('div');
      const descWrapper = document.createElement('div');
      const descSpan = document.createElement('span');
      const heading = document.createElement('strong');
      heading.textContent = name;
      descSpan.appendChild(heading);
      descSpan.appendChild(document.createTextNode(' some description.'));
      descWrapper.appendChild(descSpan);
      card.appendChild(descWrapper);
      const controls = document.createElement('div');
      controls.textContent = 'controls';
      card.appendChild(controls);
      stack.appendChild(card);
    }
    document.body.appendChild(stack);
    return stack;
  }

  test('finds the Themes card, not an inner wrapper', () => {
    const stack = renderSettingsStack();
    const card = findThemesCard(document);
    expect(card).not.toBeNull();
    expect(card.parentElement).toBe(stack);
    expect(card.textContent).toContain('Themes');
    expect(card.textContent).toContain('controls');
  });

  test('returns null when no "Themes" heading exists', () => {
    document.body.innerHTML = '<div><span>Nothing here</span></div>';
    expect(findThemesCard(document)).toBeNull();
  });

  test('does not match a heading whose ancestors never reach a wide-enough stack', () => {
    document.body.innerHTML = '<div><span><strong>Themes</strong></span></div>';
    expect(findThemesCard(document)).toBeNull();
  });
});
