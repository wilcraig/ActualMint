const express = require('express');

const { getActualClient } = require('../actual-client');

const router = express.Router();

// Flattens Actual's category groups into a plain list for the widget-builder
// picker. Hidden groups are dropped entirely, and hidden categories are
// dropped even when their group is visible.
router.get('/', async (req, res, next) => {
  try {
    const client = await getActualClient();
    const categoryGroups = await client.getCategoryGroups();

    const categories = [];
    for (const group of categoryGroups || []) {
      if (group.hidden) {
        continue;
      }
      for (const category of group.categories || []) {
        if (category.hidden) {
          continue;
        }
        categories.push({ id: category.id, name: category.name, groupName: group.name });
      }
    }

    res.status(200).json({ categories });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
