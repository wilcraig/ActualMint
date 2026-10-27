import { copyText } from '../../src/widget-builder/clipboard';

test('uses navigator.clipboard when available and resolves true', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const result = await copyText('hello', { clipboard: { writeText } });
  expect(result).toBe(true);
  expect(writeText).toHaveBeenCalledWith('hello');
});

test('falls back to execCommand when clipboard is unavailable', async () => {
  const execCommand = vi.fn().mockReturnValue(true);
  const doc = document; // jsdom's real document, to exercise real textarea creation/selection
  const result = await copyText('hello', { clipboard: undefined, execCommand, doc });
  expect(result).toBe(true);
  expect(execCommand).toHaveBeenCalledWith('copy');
});

test('falls back to execCommand when clipboard.writeText rejects', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('not a secure context'));
  const execCommand = vi.fn().mockReturnValue(true);
  const result = await copyText('hello', { clipboard: { writeText }, execCommand, doc: document });
  expect(result).toBe(true);
});

test('resolves false when both mechanisms are unavailable', async () => {
  const result = await copyText('hello', { clipboard: undefined, execCommand: undefined, doc: document });
  expect(result).toBe(false);
});

test('resolves false, not throwing, when execCommand itself throws', async () => {
  const execCommand = vi.fn(() => { throw new Error('denied'); });
  const result = await copyText('hello', { clipboard: undefined, execCommand, doc: document });
  expect(result).toBe(false);
});
