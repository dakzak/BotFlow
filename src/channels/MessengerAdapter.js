const ChannelAdapter = require('./ChannelAdapter');

/**
 * Phase 3 — Messenger via l'API Meta (page Facebook + webhooks).
 * Même démarche que InstagramAdapter : implémenter le contrat,
 * puis enregistrer l'adaptateur dans ChannelRegistry.js.
 */
class MessengerAdapter extends ChannelAdapter {
  constructor() {
    super('messenger');
  }
}

module.exports = new MessengerAdapter();
