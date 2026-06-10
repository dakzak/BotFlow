const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { TEST_DB_PATH, TEST_DB_URL } = require('./testDb');

/**
 * Avant TOUTE la suite : base de test neuve + schéma Prisma appliqué.
 * `prisma db push` reflète schema.prisma sans toucher aux migrations.
 */
module.exports = async () => {
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
  fs.rmSync(TEST_DB_PATH, { force: true });

  execSync('npx prisma db push --skip-generate', {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: 'pipe',
  });
};
