const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requireAuth);

/** GET /api/org — informations de l'organisation courante (membres + nb d'agents). */
router.get('/', asyncHandler(async (req, res) => {
  const db = getDb();
  const org = await db.organization.findUnique({
    where: { id: req.auth.orgId },
    select: { id: true, name: true, plan: true, max_agents: true, created_at: true },
  });
  if (!org) return res.status(404).json({ error: 'Organisation introuvable' });

  const members = await db.member.findMany({
    where: { org_id: req.auth.orgId },
    select: { id: true, email: true, role: true, created_at: true },
  });
  const agentCount = await db.agent.count({ where: { org_id: req.auth.orgId } });

  res.json({ ...org, members, agentCount, me: { email: req.auth.email, role: req.auth.role } });
}));

/** PATCH /api/org — renommer l'organisation (owner/admin). */
router.patch('/', asyncHandler(async (req, res) => {
  if (!['owner', 'admin'].includes(req.auth.role)) {
    return res.status(403).json({ error: 'Réservé au propriétaire / admin' });
  }
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name est requis' });
  await getDb().organization.update({ where: { id: req.auth.orgId }, data: { name } });
  res.json({ ok: true });
}));

/** POST /api/org/members — ajouter un membre (owner/admin). Body : { email, password, role? } */
router.post('/members', asyncHandler(async (req, res) => {
  if (!['owner', 'admin'].includes(req.auth.role)) {
    return res.status(403).json({ error: 'Réservé au propriétaire / admin' });
  }
  const { email, password, role } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email et password sont requis' });
  }

  const db = getDb();
  if (await db.member.findUnique({ where: { email } })) {
    return res.status(409).json({ error: 'Cet e-mail est déjà utilisé' });
  }

  const safeRole = role === 'admin' ? 'admin' : 'member';
  const member = await db.member.create({
    data: { org_id: req.auth.orgId, email, password: bcrypt.hashSync(password, 10), role: safeRole },
    select: { id: true, email: true, role: true },
  });
  res.status(201).json(member);
}));

module.exports = router;
