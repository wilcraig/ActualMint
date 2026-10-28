const fs = require('fs/promises');
const path = require('path');

// Where goals.json lives. In the container this is a bind-mounted volume;
// tests pass an explicit dataDir so they never touch /data.
const DATA_DIR = process.env.ACTUALMINT_DATA_DIR || '/data';

const FILE_NAME = 'goals.json';

// Returns the stored goals, or [] if the file has never been written. Any
// other read or parse error propagates: a corrupt-but-present file should
// fail loudly rather than silently reset to empty.
async function readGoals(dataDir = DATA_DIR) {
  try {
    const raw = await fs.readFile(path.join(dataDir, FILE_NAME), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Writes the whole list to a temp file, then renames it over goals.json.
// rename() is atomic on the same filesystem, so readers never see a
// half-written file.
async function writeGoals(goals, dataDir = DATA_DIR) {
  const finalPath = path.join(dataDir, FILE_NAME);
  const tmpPath = `${finalPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(goals));
  await fs.rename(tmpPath, finalPath);
}

module.exports = { readGoals, writeGoals, DATA_DIR };
