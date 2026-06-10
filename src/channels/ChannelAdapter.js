/**
 * Contrat commun à TOUS les canaux (cahier des charges §6.4.1).
 *
 * Un canal (WhatsApp, Instagram, Messenger, TikTok, Voix) :
 *  - démarre / arrête une connexion PAR AGENT ;
 *  - expose un statut et, si applicable, un artefact d'authentification (QR) ;
 *  - envoie des messages texte et des médias ;
 *  - pousse les messages entrants au moteur sous une forme NORMALISÉE :
 *      { agentId, channel, customerId, customerName, text, media }
 *
 * Ajouter un canal = écrire une sous-classe + l'enregistrer dans ChannelRegistry.
 * Le moteur de conversation ne doit JAMAIS être modifié pour un nouveau canal.
 */
class ChannelAdapter {
  constructor(name) {
    if (!name) throw new Error('Un ChannelAdapter doit avoir un nom');
    this.name = name;
    this._inboundHandler = null;
  }

  /** Démarre / restaure la connexion de l'agent. */
  // eslint-disable-next-line no-unused-vars
  async start(agentId) {
    throw new Error(`start() non implémenté pour le canal ${this.name}`);
  }

  /** Ferme la connexion et nettoie les ressources en mémoire. */
  // eslint-disable-next-line no-unused-vars
  async stop(agentId) {
    throw new Error(`stop() non implémenté pour le canal ${this.name}`);
  }

  /** 'disconnected' | 'connecting' | 'qr_ready' | 'connected' */
  // eslint-disable-next-line no-unused-vars
  getStatus(agentId) {
    return 'disconnected';
  }

  /** Artefact d'authentification (ex. contenu du QR WhatsApp), sinon null. */
  // eslint-disable-next-line no-unused-vars
  getAuthArtifact(agentId) {
    return null;
  }

  /** Supprime la session persistée de l'agent (déconnexion définitive). */
  // eslint-disable-next-line no-unused-vars
  clearSession(agentId) {}

  // eslint-disable-next-line no-unused-vars
  async sendMessage(agentId, to, text) {
    throw new Error(`sendMessage() non implémenté pour le canal ${this.name}`);
  }

  // eslint-disable-next-line no-unused-vars
  async sendMedia(agentId, to, mediaUrl, caption) {
    throw new Error(`sendMedia() non implémenté pour le canal ${this.name}`);
  }

  /** Le moteur s'abonne ici ; l'adaptateur appelle _emitInbound() à chaque message client. */
  onInboundMessage(handler) {
    this._inboundHandler = handler;
  }

  async _emitInbound(normalizedMessage) {
    if (this._inboundHandler) {
      return this._inboundHandler({ channel: this.name, ...normalizedMessage });
    }
    return null;
  }
}

module.exports = ChannelAdapter;
