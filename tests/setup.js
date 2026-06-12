// Environnement de test : base SQLite jetable (créée par globalSetup),
// secret JWT factice, sessions dans un dossier temporaire — aucun accès réseau.
const path = require('path');
const { TEST_DB_URL } = require('./testDb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.SESSIONS_DIR = path.join(__dirname, '.tmp-sessions');
process.env.WEBCACHE_DIR = path.join(__dirname, '.tmp-webcache');
process.env.DATABASE_URL = TEST_DB_URL;
