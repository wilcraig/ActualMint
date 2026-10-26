import { isReportsPath, watchRoute } from '../../src/widget-builder/route-watcher';

test('isReportsPath matches /reports and /reports/*, not /budget or /', () => {
  expect(isReportsPath('/reports')).toBe(true);
  expect(isReportsPath('/reports/abc123')).toBe(true);
  expect(isReportsPath('/budget')).toBe(false);
  expect(isReportsPath('/')).toBe(false);
});

function fakeWindow(initialPath) {
  const listeners = {};
  const location = { pathname: initialPath };
  const history = {
    pushState(state, title, url) { location.pathname = url; },
    replaceState(state, title, url) { location.pathname = url; },
  };
  return {
    location,
    history,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type, fn) => { if (listeners[type] === fn) delete listeners[type]; },
    _firePopstate: () => listeners['popstate']?.(),
  };
}

test('calls onChange immediately with the current path', () => {
  const win = fakeWindow('/reports');
  const onChange = vi.fn();
  watchRoute(win, onChange);
  expect(onChange).toHaveBeenCalledWith('/reports');
});

test('calls onChange again after pushState changes the path', () => {
  const win = fakeWindow('/budget');
  const onChange = vi.fn();
  watchRoute(win, onChange);
  win.history.pushState({}, '', '/reports');
  expect(onChange).toHaveBeenLastCalledWith('/reports');
});

test('calls onChange again after a popstate event', () => {
  const win = fakeWindow('/budget');
  const onChange = vi.fn();
  watchRoute(win, onChange);
  win.location.pathname = '/reports';
  win._firePopstate();
  expect(onChange).toHaveBeenLastCalledWith('/reports');
});

test('unwatch restores the original pushState/replaceState and stops further calls', () => {
  const win = fakeWindow('/budget');
  const originalPush = win.history.pushState;
  const onChange = vi.fn();
  const unwatch = watchRoute(win, onChange);
  unwatch();
  expect(win.history.pushState).toBe(originalPush);
  onChange.mockClear();
  win.history.pushState({}, '', '/reports');
  expect(onChange).not.toHaveBeenCalled();
});
