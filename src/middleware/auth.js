const jwt = require('jsonwebtoken');
const { randomBytes } = require('crypto');

// Secret de secours généré au démarrage si JWT_SECRET est absent en production :
// le service reste utilisable, mais les jetons seront invalidés à chaque
// redéploiement. TOUJOURS définir JWT_SECRET dans les variables Railway.
let generatedSecret = null;

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    if (!generatedSecret) {
      generatedSecret = randomBytes(32).toString('hex');
      console.error(
        '⚠️  JWT_SECRET non défini : secret temporaire généré pour ce démarrage. ' +
        'Les sessions seront perdues au prochain redéploiement — ' +
        'ajoutez JWT_SECRET dans les variables d\'environnement Railway.'
      );
    }
    return generatedSecret;
  }
  return 'dev-secret-ne-pas-utiliser-en-production';
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
