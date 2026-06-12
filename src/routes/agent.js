const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const aiRegistry = require('../ai/AIRegistry');

const router = express.Router();
router.use(requireAuth);

/** Récupère un agent UNIQUEMENT s'il appartient à l'organisation du jeton. */
async function getAgentScoped(db, orgId, agentId) {
  return db.agent.findFirst({ where: { id: agentId, org_id: orgId } });
}

/** Version « frontend » d'un agent : les clés d'API ne sortent JAMAIS en clair. */
function publicAgent(agent) {
  const tokens = JSON.parse(agent.ai_tokens || '[]');
  const { ai_tokens, ...rest } = agent;
  return {
    ...rest,
    ai_keys_count: tokens.length,
    sheet_columns: agent.sheet_columns ? JSON.parse(agent.sheet_columns) : null,
    sheet_analysis: agent.sheet_analysis ? JSON.parse(agent.sheet_analysis) : null,
  };
}

/** GET /api/agents — tous les agents de l'organisation. */
router.get('/', asyncHandler(async (req, res) => {
  const agents = await getDb().agent.findMany({
    where: { org_id: req.auth.orgId },
    orderBy: { created_at: 'desc' },
  });
  res.json(agents.map(publicAgent));
}));

/** POST /api/agents — étape 1 du wizard (identité). Body : { name, description } */
router.post('/', asyncHandler(async (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name est requis' });

  const db = getDb();
  const org = await db.organization.findUnique({
    where: { id: req.auth.orgId },
    select: { max_agents: true },
  });
  const count = await db.agent.count({ where: { org_id: req.auth.orgId } });
  if (count >= org.max_agents) {
    return res.status(403).json({ error: `Quota atteint (${org.max_agents} agents max pour votre formule)` });
  }

  const agent = await db.agent.create({
    data: { org_id: req.auth.orgId, name, description: description || '' },
  });
  res.status(201).json(publicAgent(agent));
}));

/** GET /api/agents/:id */
router.get('/:id', asyncHandler(async (req, res) => {
  const agent = await getAgentScoped(getDb(), req.auth.orgId, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent introuvable' });
  res.json(publicAgent(agent));
}));

/** PATCH /api/agents/:id — mise à jour de la configuration (liste blanche de champs). */
router.patch('/:id', asyncHandler(async (req, res) => {
  const db = getDb();
  const agent = await getAgentScoped(db, req.auth.orgId, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent introuvable' });

  const editable = [
    'name', 'description', 'business_type', 'status', 'whatsapp_number',
    'data_source_type', 'source_ref', 'ai_provider', 'ai_model',
  ];
  const data = {};
  for (const field of editable) {
    if (req.body[field] !== undefined) data[field] = req.body[field];
  }
  if (Array.isArray(req.body.ai_tokens)) {
    data.ai_tokens = JSON.stringify(
      req.body.ai_tokens.map((k) => String(k).trim()).filter(Boolean)
    );
  }
  if (!Object.keys(data).length) {
    return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
  }

  // Changer de source de données invalide l'analyse des colonnes : sans ça,
  // le bot continuerait à interpréter le NOUVEAU catalogue avec le mapping
  // de l'ANCIEN (réponses fausses). Le frontend relance l'analyse après coup.
  if (data.source_ref !== undefined && data.source_ref !== agent.source_ref) {
    data.sheet_columns = null;
    data.sheet_analysis = null;
  }

  const updated = await db.agent.update({ where: { id: agent.id }, data });
  res.json(publicAgent(updated));
}));

/** DELETE /api/agents/:id — supprime l'agent, sa connexion canal et sa session. */
router.delete('/:id', asyncHandler(async (req, res) => {
  const db = getDb();
  const agent = await getAgentScoped(db, req.auth.orgId, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent introuvable' });

  const channelRegistry = require('../channels/ChannelRegistry');
  const whatsapp = channelRegistry.get('whatsapp');
  try {
    await whatsapp.stop(agent.id);
    whatsapp.clearSession(agent.id);
  } catch { /* l'agent n'était pas connecté */ }

  await db.agent.delete({ where: { id: agent.id } }); // cascade : conversations + transactions
  res.json({ ok: true });
}));

/** GET /api/agents/:id/overview — statistiques + conversations récentes (onglet Vue d'ensemble). */
router.get('/:id/overview', asyncHandler(async (req, res) => {
  const db = getDb();
  const agent = await getAgentScoped(db, req.auth.orgId, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent introuvable' });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const conversationsToday = await db.conversation.count({
    where: { agent_id: agent.id, last_message_at: { gte: startOfDay } },
  });
  const transactionsCount = await db.transaction.count({ where: { agent_id: agent.id } });
  const activeCustomers = (
    await db.conversation.findMany({
      where: { agent_id: agent.id, last_message_at: { gte: weekAgo } },
      distinct: ['customer_id'],
      select: { customer_id: true },
    })
  ).length;

  const recentConversations = (
    await db.conversation.findMany({
      where: { agent_id: agent.id },
      orderBy: { last_message_at: 'desc' },
      take: 10,
    })
  ).map((c) => {
    const msgs = JSON.parse(c.messages || '[]');
    return {
      id: c.id,
      customer_id: c.customer_id,
      customer_name: c.customer_name,
      channel: c.channel,
      last_message_at: c.last_message_at,
      messageCount: msgs.length,
      lastMessage: msgs.length ? msgs[msgs.length - 1].content : '',
    };
  });

  res.json({ conversationsToday, transactionsCount, activeCustomers, recentConversations });
}));

/**
 * POST /api/agents/:id/ai/test — étape 3 du wizard : valider une clé d'API.
 * Body : { provider?, apiKey, model? } — utilise la config de l'agent par défaut.
 */
router.post('/:id/ai/test', asyncHandler(async (req, res) => {
  const db = getDb();
  const agent = await getAgentScoped(db, req.auth.orgId, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent introuvable' });

  const { provider, apiKey, model } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: 'apiKey est requis' });

  const aiProvider = aiRegistry.get(provider || agent.ai_provider || 'groq');
  const ok = await aiProvider.test(apiKey, model || agent.ai_model);
  res.json({ ok });
}));

module.exports = router;
module.exports.getAgentScoped = getAgentScoped;
module.exports.publicAgent = publicAgent;
