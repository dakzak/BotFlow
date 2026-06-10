const fs = require('fs');
const path = require('path');

/**
 * Persistance des sessions de canal, un dossier PAR AGENT :
 * {SESSIONS_DIR}/{agentId}/ — survit aux redémarrages (volume Railway).
 */

function sessionsRoot() {
  return process.env.SESSIONS_DIR || path.join(process.cwd(), 'sessions');
}

function sessionDir(agentId) {
  // garde-fou : un agentId est un UUID, jamais un chemin
  const safe = String(agentId).replace(/[^a-zA-Z0-9-]/g, '');
  return path.join(sessionsRoot(), safe);
}

/** Liste les agents ayant une session sauvegardée sur disque. */
function listSavedSessions() {
  try {
    return fs.readdirSync(sessionsRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function clearSession(agentId) {
  fs.rmSync(sessionDir(agentId), { recursive: true, force: true });
}

module.exports = { sessionsRoot, sessionDir, listSavedSessions, clearSession };
