const express = require('express');
const QRCode = require('qrcode');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const channelRegistry = require('../channels/ChannelRegistry');

const router = express.Router();
router.use(requireAuth);

async function getAgentScoped(db, orgId, agentId) {
  return db.agent.findFirst({ where: { id: agentId, org_id: orgId } });
}

/**
 * POST /api/agents/:id/channel/connect — démarre la connexion du canal.
 * Body : { channel?: 'whatsapp', whatsapp_number?: string }
 */
router.post('/:id/channel/connect', asyncHandler(async (req, res) => {
  const db = getDb();
  const agent = await getAgentScoped(db, req.auth.orgId, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent introuvable' });

  const channelName = (req.body && req.body.channel) || 'whatsapp';
  const channel = channelRegistry.get(channelName);

  if (req.body && req.body.whatsapp_number) {
    await db.agent.update({
      where: { id: agent.id },
      data: { whatsapp_number: req.body.whatsapp_number },
    });
  }

  await channel.start(agent.id);
  res.json({ status: channel.getStatus(agent.id) });
}));

/**
 * GET /api/agents/:id/channel/status — statut temps réel + QR code (data URL).
 * Le frontend interroge cette route en boucle pendant la connexion.
 */
router.get('/:id/channel/status', asyncHandler(async (req, res) => {
  const db = getDb();
  const agent = await getAgentScoped(db, req.auth.orgId, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent introuvable' });

  const channel = channelRegistry.get(req.query.channel || 'whatsapp');
  const status = channel.getStatus(agent.id);
  const artifact = channel.getAuthArtifact(agent.id);
  const qr = artifact ? await QRCode.toDataURL(artifact) : null;
  res.json({ status, qr });
}));

/** POST /api/agents/:id/channel/disconnect — déconnecte et nettoie la session. */
router.post('/:id/channel/disconnect', asyncHandler(async (req, res) => {
  const db = getDb();
  const agent = await getAgentScoped(db, req.auth.orgId, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent introuvable' });

  const channel = channelRegistry.get((req.body && req.body.channel) || 'whatsapp');
  await channel.stop(agent.id);
  if (req.body && req.body.clearSession) channel.clearSession(agent.id);
  res.json({ status: channel.getStatus(agent.id) });
}));

/**
 * POST /api/agents/:id/channel/test-message — étape 5 du wizard.
 * Body : { to: '2126XXXXXXXX', text?: string }
 */
router.post('/:id/channel/test-message', asyncHandler(async (req, res) => {
  const db = getDb();
  const agent = await getAgentScoped(db, req.auth.orgId, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent introuvable' });

  const { to, text } = req.body || {};
  if (!to) return res.status(400).json({ error: 'to est requis (numéro destinataire)' });

  const channel = channelRegistry.get('whatsapp');
  await channel.sendMessage(agent.id, to, text || `✅ Message de test envoyé par l'agent « ${agent.name} » via BotFlow.`);
  res.json({ ok: true });
}));

module.exports = router;
