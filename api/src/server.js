const express = require('express');
const { hasEverConnected } = require('./actual-client');
const budgetPacingRouter = require('./routes/budget-pacing');

const app = express();

app.use('/api/budget-pacing', budgetPacingRouter);

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
