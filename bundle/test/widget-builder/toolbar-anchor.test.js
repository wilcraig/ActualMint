import { findAddWidgetButton } from '../../src/widget-builder/toolbar-anchor';

beforeEach(() => {
  document.body.innerHTML = '';
});

test('finds the button whose text is exactly "Add new widget"', () => {
  document.body.innerHTML = `
    <button>Edit dashboard</button>
    <button>Add new widget</button>
    <button>Widget builder</button>
  `;
  const button = findAddWidgetButton(document);
  expect(button).not.toBeNull();
  expect(button.textContent).toBe('Add new widget');
});

test('returns null when no such button exists', () => {
  document.body.innerHTML = '<button>Edit dashboard</button>';
  expect(findAddWidgetButton(document)).toBeNull();
});
