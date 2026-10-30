const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

// Same data dir as goals-store.js. channels.json holds secrets (SMTP
// passwords, bot tokens, webhook URLs), so it is written owner-only.
const DATA_DIR = process.env.INSIGHTS_DATA_DIR || process.env.ACTUALMINT_DATA_DIR || '/data';

const FILE_NAME = 'channels.json';

// Returns the stored channels, or [] if the file has never been written. A
// corrupt-but-present file propagates the parse error rather than silently
// resetting to empty (which would drop every channel on the next write).
async function readChannels(dataDir = DATA_DIR) {
  try {
    const raw = await fs.readFile(path.join(dataDir, FILE_NAME), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Temp file plus rename, like goals-store.js, with mode 0600 set at
// creation so the secrets are never briefly world-readable.
async function writeChannels(channels, dataDir = DATA_DIR) {
  const finalPath = path.join(dataDir, FILE_NAME);
  const tmpPath = `${finalPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(channels), { mode: 0o600 });
  await fs.rename(tmpPath, finalPath);
}

module.exports = { readChannels, writeChannels, DATA_DIR };
