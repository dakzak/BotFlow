const { PrismaClient } = require('@prisma/client');

/**
 * Accès aux données via Prisma (ORM) — schéma dans prisma/schema.prisma.
 *
 * - La base est désignée par DATABASE_URL (ex. file:../data/botflow.db,
 *   résolu relativement au dossier prisma/).
 * - Le schéma est appliqué par les migrations : `npx prisma migrate dev` en
 *   local, `npx prisma migrate deploy` au démarrage sur Railway.
 * - Les validations d'énumérations (status, role...) sont applicatives
 *   (voir les routes), SQLite ne portant pas de CHECK via Prisma.
 */

let instance = null;

/** Client Prisma singleton utilisé par toute l'application. */
function getDb() {
  if (!instance) {
    instance = new PrismaClient();
  }
  return instance;
}

/** Réservé aux tests : ferme et oublie le client singleton. */
async function resetDb() {
  if (instance) {
    await instance.$disconnect();
    instance = null;
  }
}

module.exports = { getDb, resetDb };
