/**
 * Registre des canaux disponibles.
 * Pour activer un nouveau canal (Phase 3/4) :
 *   registry.register(require('./InstagramAdapter'));
 */
class ChannelRegistry {
  constructor() {
    this.adapters = new Map();
  }

  register(adapter) {
    this.adapters.set(adapter.name, adapter);
    return adapter;
  }

  get(name) {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      const err = new Error(`Canal inconnu ou non activé : ${name}`);
      err.status = 400;
      throw err;
    }
    return adapter;
  }

  list() {
    return [...this.adapters.values()];
  }
}

const registry = new ChannelRegistry();

// Canaux actifs (MVP : WhatsApp uniquement)
registry.register(require('./WhatsAppAdapter'));
// Phase 3 : registry.register(require('./InstagramAdapter'));
// Phase 3 : registry.register(require('./MessengerAdapter'));
// Phase 4 : registry.register(require('./VoiceAdapter'));

module.exports = registry;
