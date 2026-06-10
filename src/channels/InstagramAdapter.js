const ChannelAdapter = require('./ChannelAdapter');

/**
 * Phase 3 — Instagram DM via l'API Messaging de Meta (compte professionnel,
 * jetons d'accès, webhooks).
 *
 * Pour l'implémenter :
 *  1. implémenter start/stop/getStatus/sendMessage/sendMedia ci-dessous
 *     (réception via webhook -> this._emitInbound({...} normalisé)) ;
 *  2. l'enregistrer dans ChannelRegistry.js ;
 *  3. le moteur de conversation fonctionne tel quel, sans modification.
 */
class InstagramAdapter extends ChannelAdapter {
  constructor() {
    super('instagram');
  }
}

module.exports = new InstagramAdapter();
