const express = require('express');
const { hasEverConnected } = require('./actual-client');

const app = express();

app.get('/health', (req, res) => {
  if (hasEverConnected()) {
    res.status(200).json({ ok: true });
  } else {
    res.status(503).json({ ok: false });
  }
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3011;
  app.listen(port, () => {
    console.log(`actualmint-api listening on :${port}`);
  });
}

module.exports = app;
