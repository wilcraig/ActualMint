const fs = require('fs/promises');
const path = require('path');
const os = require('os');

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'goals-store-test-'));
}

test('readGoals returns an empty array when goals.json does not exist yet', async () => {
  const dir = await tmpDir();
  const { readGoals } = require('../src/goals-store');
  expect(await readGoals(dir)).toEqual([]);
});

test('writeGoals then readGoals round-trips the exact list', async () => {
  const dir = await tmpDir();
  const { readGoals, writeGoals } = require('../src/goals-store');
  const goals = [{ id: 'g1', entityType: 'category', entityId: 'catA', targetAmountCents: 50000, targetDate: '2026-12-25' }];
  await writeGoals(goals, dir);
  expect(await readGoals(dir)).toEqual(goals);
});

test('writeGoals never leaves a half-written file on disk (writes to a temp file then renames)', async () => {
  const dir = await tmpDir();
  const { writeGoals } = require('../src/goals-store');
  await writeGoals([{ id: 'g1', entityType: 'account', entityId: 'accA', targetAmountCents: 100, targetDate: '2026-01-01' }], dir);
  const files = await fs.readdir(dir);
  // Only the final goals.json should remain -- no leftover .tmp file from the rename.
  expect(files).toEqual(['goals.json']);
});
