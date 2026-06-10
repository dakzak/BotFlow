const ChannelAdapter = require('./ChannelAdapter');

/**
 * Phase 4 — Canal vocal : messages vocaux (STT/TTS) puis appels téléphoniques
 * temps réel (Twilio Voice / Vonage).
 *
 * Boucle cible : audio entrant -> STT -> chatEngine (inchangé) -> TTS -> audio sortant.
 * Le texte transcrit passe par this._emitInbound({...}) comme n'importe quel canal.
 */
class VoiceAdapter extends ChannelAdapter {
  constructor() {
    super('voice');
  }
}

module.exports = new VoiceAdapter();
