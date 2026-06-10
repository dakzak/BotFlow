const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');
const { signToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

/**
 * POST /api/register — crée l'organisation ET son membre propriétaire
 * (création imbriquée Prisma : atomique).
 * Body : { orgName, email, password }
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { orgName, email, password } = req.body || {};
  if (!orgName || !email || !password) {
    return res.status(400).json({ error: 'orgName, email et password sont requis' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit faire 8 caractères minimum' });
  }

  const db = getDb();
  if (await db.member.findUnique({ where: { email } })) {
    return res.status(409).json({ error: 'Cet e-mail est déjà utilisé' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const org = await db.organization.create({
    data: {
      name: orgName,
      owner_email: email,
      owner_password: hash,
      members: {
        create: { email, password: hash, role: 'owner' },
      },
    },
    include: { members: true },
  });

  const member = org.members[0];
  const token = signToken({ orgId: org.id, memberId: member.id, role: 'owner', email });
  res.status(201).json({
    token,
    org: { id: org.id, name: org.name, plan: org.plan, max_agents: org.max_agents },
  });
}));

/**
 * POST /api/login
 * Body : { email, password }
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email et password sont requis' });
  }

  const db = getDb();
  const member = await db.member.findUnique({ where: { email } });
  if (!member || !bcrypt.compareSync(password, member.password)) {
    return res.status(401).json({ error: 'Identifiants invalides' });
  }

  const org = await db.organization.findUnique({
    where: { id: member.org_id },
    select: { id: true, name: true, plan: true, max_agents: true },
  });
  const token = signToken({ orgId: member.org_id, memberId: member.id, role: member.role, email });
  res.json({ token, org });
}));

module.exports = router;
