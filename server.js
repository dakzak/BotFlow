
require('dotenv').config();

const { createApp } = require('./src/app');
const { getDb } = require('./src/db/database');
const channelRegistry = require('./src/channels/ChannelRegistry');
const chatEngine = require('./src/services/chatEngine');

const PORT = process.env.PORT || 3000;

async function main() {
  const db = getDb(); // client Prisma (schéma appliqué par `prisma migrate`)

  // Câblage canal -> moteur de conversation.
  // Identique pour TOUS les canaux : un adaptateur pousse un message normalisé,
  // le moteur répond, l'adaptateur traduit la réponse dans son format natif.
  for (const adapter of channelRegistry.list()) {
    adapter.onInboundMessage(async (message) => {
      try {
        const reply = await chatEngine.handleInboundMessage(message);
        if (!reply) return;
        if (reply.mediaUrl) {
          await adapter.sendMedia(message.agentId, message.customerId, reply.mediaUrl, reply.text);
        } else if (reply.text) {
          await adapter.sendMessage(message.agentId, message.customerId, reply.text);
        }
      } catch (err) {
        console.error(`[chat] agent=${message.agentId} erreur:`, err.message);
      }
    });
  }

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`✅ BotFlow démarré sur http://localhost:${PORT}`);
  });

  // Reconnexion automatique des agents actifs ayant une session WhatsApp sauvegardée
  const whatsapp = channelRegistry.get('whatsapp');
  const activeAgents = await db.agent.findMany({
    where: { status: 'active' },
    select: { id: true },
  });
  for (const { id } of activeAgents) {
    if (whatsapp.hasSavedSession(id)) {
      console.log(`[whatsapp] reconnexion de l'agent ${id}...`);
      whatsapp.start(id).catch((err) => {
        console.error(`[whatsapp] reconnexion agent=${id} échouée:`, err.message);
      });
    }
  }
}

main().catch((err) => {
  console.error('Échec du démarrage:', err);
  process.exit(1);
});
