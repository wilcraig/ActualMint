import { mountPanel } from '../../src/widget-builder/mount-panel';

test('appends a div to document.body and instantiates the component with it as target', () => {
  const Instances = [];
  class FakePanel {
    constructor(opts) { Instances.push(opts); }
  }

  const before = document.body.children.length;
  mountPanel(document, FakePanel);

  expect(document.body.children.length).toBe(before + 1);
  expect(Instances).toHaveLength(1);
  expect(Instances[0].target).toBe(document.body.lastElementChild);
});
