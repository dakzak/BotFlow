// Emplacement partagé de la base de test (globalSetup + setup).
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, '.tmp', 'test.db');
// URL SQLite : Prisma attend des slashs, même sous Windows
const TEST_DB_URL = 'file:' + TEST_DB_PATH.replace(/\\/g, '/');

module.exports = { TEST_DB_PATH, TEST_DB_URL };
