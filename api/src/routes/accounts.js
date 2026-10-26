const express = require('express');

const { getActualClient } = require('../actual-client');

const router = express.Router();

// Lists open accounts for the widget-builder account picker. Closed accounts
// are dropped; everything else is reduced to { id, name }.
router.get('/', async (req, res, next) => {
  try {
    const client = await getActualClient();
    const allAccounts = await client.getAccounts();

    const accounts = (allAccounts || [])
      .filter((account) => !account.closed)
      .map((account) => ({ id: account.id, name: account.name }));

    res.status(200).json({ accounts });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
