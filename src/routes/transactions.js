const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requireAuth);

async function getAgentScoped(db, orgId, agentId) {
  return db.agent.findFirst({ where: { id: agentId, org_id: orgId } });
}

/** Convertit une liste de transactions en CSV (colonnes dynamiques selon le métier). */
function transactionsToCsv(rows) {
  const dataKeys = [...new Set(rows.flatMap((r) => Object.keys(JSON.parse(r.data || '{}'))))];
  const headers = ['id', 'created_at', 'customer_name', 'customer_id', 'transaction_type', 'status', ...dataKeys];
  const esc = (v) => {
    if (v instanceof Date) v = v.toISOString();
    const s = String(v == null ? '' : v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    const data = JSON.parse(r.data || '{}');
    lines.push(headers.map((h) => esc(dataKeys.includes(h) ? data[h] : r[h])).join(','));
  }
  return lines.join('\n');
}

/** GET /api/agents/:id/transactions?status=pending|confirmed|cancelled */
router.get('/agents/:id/transactions', asyncHandler(async (req, res) => {
  const db = getDb();
  const agent = await getAgentScoped(db, req.auth.orgId, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent introuvable' });

  const rows = await db.transaction.findMany({
    where: {
      agent_id: agent.id,
      org_id: req.auth.orgId,
      ...(req.query.status ? { status: req.query.status } : {}),
    },
    orderBy: { created_at: 'desc' },
    take: 500,
  });
  res.json(rows.map((r) => ({ ...r, data: JSON.parse(r.data || '{}') })));
}));

/** GET /api/agents/:id/transactions/export.csv — export CSV. */
router.get('/agents/:id/transactions/export.csv', asyncHandler(async (req, res) => {
  const db = getDb();
  const agent = await getAgentScoped(db, req.auth.orgId, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent introuvable' });

  const rows = await db.transaction.findMany({
    where: { agent_id: agent.id, org_id: req.auth.orgId },
    orderBy: { created_at: 'desc' },
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${agent.id}.csv"`);
  res.send('﻿' + transactionsToCsv(rows)); // BOM pour Excel
}));

/** PATCH /api/transactions/:txId — changement de statut manuel. Body : { status } */
router.patch('/transactions/:txId', asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'confirmed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'status doit être pending, confirmed ou cancelled' });
  }
  // updateMany pour filtrer par org_id : l'isolation reste garantie
  const result = await getDb().transaction.updateMany({
    where: { id: req.params.txId, org_id: req.auth.orgId },
    data: { status },
  });
  if (result.count === 0) return res.status(404).json({ error: 'Transaction introuvable' });
  res.json({ ok: true, status });
}));

module.exports = router;
module.exports.transactionsToCsv = transactionsToCsv;
