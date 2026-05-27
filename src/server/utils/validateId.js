'use strict';

const { safeId } = require('../state/validation');

function requireValidId(req, res, next) {
  const id = safeId(req.body && req.body.id);
  if (id === null) return res.status(400).json({ error: 'invalid id' });
  req.cid = id;
  next();
}

module.exports = { requireValidId };
