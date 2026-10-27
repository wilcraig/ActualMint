import { fixBudgetIconCrop } from '../src/budget-icon-fix';

beforeEach(() => {
  document.head.innerHTML = '';
});

test('fixBudgetIconCrop creates a style element overriding object-fit to contain', () => {
  fixBudgetIconCrop(document);
  const styleEl = document.getElementById('actualmint-budget-icon-fix');
  expect(styleEl).not.toBeNull();
  expect(styleEl.textContent).toContain('.budget-icon-img');
  expect(styleEl.textContent).toContain('object-fit: contain');
  expect(styleEl.textContent).toContain('!important');
});

test('fixBudgetIconCrop does not create a second style element if called again', () => {
  fixBudgetIconCrop(document);
  fixBudgetIconCrop(document);
  const styleEls = document.querySelectorAll('#actualmint-budget-icon-fix');
  expect(styleEls.length).toBe(1);
});
