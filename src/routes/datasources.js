const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const dataSourceRegistry = require('../datasources/DataSourceRegistry');

const router = express.Router();
router.use(requireAuth);

async function getAgentScoped(db, orgId, agentId) {
  return db.agent.findFirst({ where: { id: agentId, org_id: orgId } });
}

/**
 * POST /api/agents/:id/datasource/analyze — étape 2 du wizard.
 * Body : { type?: 'google_sheets', ref: 'https://docs.google.com/spreadsheets/...' }
 * Lit les premières lignes, détecte le sens des colonnes et sauvegarde le mapping.
 */
router.post('/:id/datasource/analyze', asyncHandler(async (req, res) => {
  const db = getDb();
  const agent = await getAgentScoped(db, req.auth.orgId, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent introuvable' });

  const type = (req.body && req.body.type) || agent.data_source_type || 'google_sheets';
  const ref = (req.body && req.body.ref) || agent.source_ref;
  if (!ref) return res.status(400).json({ error: 'ref est requis (URL de la source)' });

  const source = dataSourceRegistry.create(type, { ref });
  const analysis = await source.analyze();

  await db.agent.update({
    where: { id: agent.id },
    data: {
      data_source_type: type,
      source_ref: ref,
      sheet_columns: JSON.stringify(analysis.headers),
      sheet_analysis: JSON.stringify(analysis),
    },
  });

  res.json(analysis);
}));

/**
 * POST /api/agents/:id/datasource/mapping — confirmation / ajustement du mapping par l'utilisateur.
 * Body : { mapping: { "Nom de colonne": "name|price|city|category|availability|image_url|description|other" } }
 */
router.post('/:id/datasource/mapping', asyncHandler(async (req, res) => {
  const db = getDb();
  const agent = await getAgentScoped(db, req.auth.orgId, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent introuvable' });

  const analysis = agent.sheet_analysis ? JSON.parse(agent.sheet_analysis) : {};
  if (req.body && req.body.mapping) analysis.mapping = req.body.mapping;
  analysis.confirmedAt = new Date().toISOString();

  await db.agent.update({
    where: { id: agent.id },
    data: { sheet_analysis: JSON.stringify(analysis) },
  });
  res.json(analysis);
}));

/** GET /api/agents/:id/datasource/preview?limit=20 — aperçu pour l'onglet Données. */
router.get('/:id/datasource/preview', asyncHandler(async (req, res) => {
  const db = getDb();
  const agent = await getAgentScoped(db, req.auth.orgId, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent introuvable' });
  if (!agent.data_source_type || !agent.source_ref) {
    return res.status(400).json({ error: 'Aucune source de données configurée pour cet agent' });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const source = dataSourceRegistry.create(agent.data_source_type, { ref: agent.source_ref });
  res.json(await source.fetchPreview(limit));
}));

module.exports = router;
