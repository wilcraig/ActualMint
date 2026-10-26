const express = require('express');
const { hasEverConnected } = require('./actual-client');
const { validateToken } = require('./auth');
const budgetPacingRouter = require('./routes/budget-pacing');

const app = express();

// Actual's own client sends its session token as `X-ACTUAL-TOKEN` (see
// auth.js for the confirmed mechanism). Require a valid one on every
// /api/* route so a later plan's new routes are covered automatically
// without each needing to remember to add auth themselves.
async function requireAuth(req, res, next) {
  const token = req.get('X-ACTUAL-TOKEN');
  if (!token || !(await validateToken(token))) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

app.use('/api', requireAuth);
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
