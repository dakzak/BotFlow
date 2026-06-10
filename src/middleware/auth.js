const jwt = require('jsonwebtoken');

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET est obligatoire en production');
    }
    return 'dev-secret-ne-pas-utiliser-en-production';
  }
  return secret;
}

/**
 * Middleware d'authentification : vérifie le JWT « Bearer » et attache
 * req.auth = { orgId, memberId, role, email }.
 * Toutes les routes privées DOIVENT passer par ici — c'est le point
 * d'entrée de l'isolation multi-organisation.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentification requise' });
  }
  try {
    const payload = jwt.verify(token, jwtSecret());
    req.auth = {
      orgId: payload.orgId,
      memberId: payload.memberId,
      role: payload.role,
      email: payload.email,
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Jeton invalide ou expiré' });
  }
}

function signToken(payload) {
  return jwt.sign(payload, jwtSecret(), { expiresIn: '7d' });
}

module.exports = { requireAuth, signToken };
