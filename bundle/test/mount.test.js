import { findPlaceholder, mountWidget } from '../src/mount';
import { buildPlaceholder } from '../src/widget-builder/placeholder';

test('finds and parses a placeholder with valid JSON config', () => {
  document.body.innerHTML = '<div id="host">{{ACTUALMINT:pacing-bars:["catA","catB"]}}</div>';
  const result = findPlaceholder('{{ACTUALMINT:pacing-bars:');
  expect(result).not.toBeNull();
  expect(result.config).toEqual(['catA', 'catB']);
  expect(result.node).toBe(document.getElementById('host'));
});

test('returns null when no placeholder is present', () => {
  document.body.innerHTML = '<div>nothing here</div>';
  expect(findPlaceholder('{{ACTUALMINT:pacing-bars:')).toBeNull();
});

test('a throwing render callback is caught and does not propagate', () => {
  document.body.innerHTML = '<div>{{ACTUALMINT:pacing-bars:[]}}</div>';
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  expect(() => {
    mountWidget('{{ACTUALMINT:pacing-bars:', () => { throw new Error('boom'); });
  }).not.toThrow();

  expect(consoleError).toHaveBeenCalled();
});

test('mounts every matching placeholder present in the same DOM snapshot', () => {
  document.body.innerHTML = `
    <div id="a">{{ACTUALMINT:pacing-bars:["x"]}}</div>
    <div id="b">{{ACTUALMINT:pacing-bars:["y"]}}</div>
  `;

  const mountedHosts = [];
  mountWidget('{{ACTUALMINT:pacing-bars:', (mountHost, config) => {
    mountedHosts.push({ mountHost, config });
  });

  expect(mountedHosts.length).toBe(2);
  // render() is given a new element mounted *inside* the original host
  // (#a / #b), not the original host itself (see the non-destructive-mount
  // test below for why).
  expect(mountedHosts.map((m) => m.mountHost.parentElement)).toEqual(
    expect.arrayContaining([document.getElementById('a'), document.getElementById('b')]),
  );
  expect(mountedHosts.map((m) => m.config)).toEqual(
    expect.arrayContaining([['x'], ['y']]),
  );
});

test('does not delete the original placeholder text node; hides it instead', () => {
  document.body.innerHTML = '<div id="host">{{ACTUALMINT:pacing-bars:["catA"]}}</div>';
  const host = document.getElementById('host');
  const originalTextNode = host.firstChild;
  expect(originalTextNode.nodeType).toBe(Node.TEXT_NODE);

  mountWidget('{{ACTUALMINT:pacing-bars:', () => {});

  // The original text node is still in the document (not removed), its
  // content untouched, just wrapped in a hidden element.
  expect(document.body.contains(originalTextNode)).toBe(true);
  expect(originalTextNode.nodeValue).toContain('{{ACTUALMINT:pacing-bars:');

  const wrapper = originalTextNode.parentElement;
  expect(wrapper).not.toBe(null);
  expect(wrapper.tagName).toBe('SPAN');
  expect(wrapper.style.display).toBe('none');
  expect(host.contains(wrapper)).toBe(true);
});

test('mounts into a new sibling element rather than clearing the host', () => {
  document.body.innerHTML = '<div id="host">{{ACTUALMINT:pacing-bars:["catA"]}}</div>';
  const host = document.getElementById('host');

  let receivedMountHost;
  mountWidget('{{ACTUALMINT:pacing-bars:', (mountHost) => {
    receivedMountHost = mountHost;
  });

  expect(receivedMountHost).not.toBe(host);
  expect(host.contains(receivedMountHost)).toBe(true);
  // Both the hidden wrapper and the new mount host are children of #host.
  expect(host.children.length).toBe(2);
});

describe('findPlaceholder parses all buildPlaceholder body shapes', () => {
  test('single-field (raw array) body', () => {
    const placeholder = buildPlaceholder('pacing-bars', [{ key: 'categories' }], {
      categories: ['catA', 'catB'],
    });
    expect(placeholder).toBe('{{ACTUALMINT:pacing-bars:["catA","catB"]}}');
    document.body.innerHTML = `<div id="host">${placeholder}</div>`;

    const result = findPlaceholder('{{ACTUALMINT:pacing-bars:');
    expect(result).not.toBeNull();
    expect(result.config).toEqual(['catA', 'catB']);
  });

  test('multi-field (keyed object) body', () => {
    const placeholder = buildPlaceholder(
      'month-end-net',
      [{ key: 'accountId' }, { key: 'months' }],
      { accountId: 'acc1', months: 6 },
    );
    expect(placeholder).toBe('{{ACTUALMINT:month-end-net:{"accountId":"acc1","months":6}}}');
    document.body.innerHTML = `<div id="host">${placeholder}</div>`;

    const result = findPlaceholder('{{ACTUALMINT:month-end-net:');
    expect(result).not.toBeNull();
    expect(result.config).toEqual({ accountId: 'acc1', months: 6 });
  });

  test('zero-field (empty object) body', () => {
    const placeholder = buildPlaceholder('month-end-net', [], {});
    expect(placeholder).toBe('{{ACTUALMINT:month-end-net:{}}}');
    document.body.innerHTML = `<div id="host">${placeholder}</div>`;

    const result = findPlaceholder('{{ACTUALMINT:month-end-net:');
    expect(result).not.toBeNull();
    expect(result.config).toEqual({});
  });
});

test('a later DOM mutation does not cause the same placeholder to be re-mounted', async () => {
  document.body.innerHTML = '<div id="host">{{ACTUALMINT:pacing-bars:["catA"]}}</div>';

  let calls = 0;
  mountWidget('{{ACTUALMINT:pacing-bars:', () => {
    calls += 1;
  });
  expect(calls).toBe(1);

  // Some unrelated DOM mutation elsewhere (e.g. Actual re-rendering another
  // part of the page) triggers the MutationObserver and another scan().
  const unrelated = document.createElement('div');
  document.body.appendChild(unrelated);
  await Promise.resolve(); // the observer's scan() is queued as a microtask

  expect(calls).toBe(1);
});
