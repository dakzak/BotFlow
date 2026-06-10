/**
 * Contrat commun à TOUS les fournisseurs d'IA (cahier des charges §6.4.3).
 *
 * La logique multi-clés avec repli (fallback) vit ICI, dans la classe de base :
 * complete() essaie keys[0], puis keys[1]... en cas d'échec / quota.
 * Chaque fournisseur concret n'implémente QUE _completeWithKey() :
 * un appel d'API avec UNE clé donnée.
 */
class AIProvider {
  constructor(name, defaultModel) {
    if (!name) throw new Error('Un AIProvider doit avoir un nom');
    this.name = name;
    this.defaultModel = defaultModel;
  }

  /**
   * Appel chat avec repli automatique sur les clés suivantes.
   * @param {Array<{role: string, content: string}>} messages
   * @param {{keys: string[], model?: string, maxTokens?: number, temperature?: number}} options
   * @returns {Promise<string>} le texte brut renvoyé par le modèle
   */
  async complete(messages, options = {}) {
    const keys = (options.keys || []).filter(Boolean);
    if (!keys.length) {
      const err = new Error(`Aucune clé d'API configurée pour ${this.name}`);
      err.status = 422;
      throw err;
    }

    let lastErr;
    for (const apiKey of keys) {
      try {
        return await this._completeWithKey(messages, {
          ...options,
          apiKey,
          model: options.model || this.defaultModel,
        });
      } catch (err) {
        lastErr = err;
        console.warn(`[ai:${this.name}] clé en échec, bascule vers la suivante : ${err.message}`);
      }
    }
    throw new Error(`Toutes les clés ${this.name} ont échoué — dernière erreur : ${lastErr.message}`);
  }

  /** Valide une clé d'API par un appel minimal. */
  async test(apiKey, model) {
    try {
      await this._completeWithKey([{ role: 'user', content: 'ping' }], {
        apiKey,
        model: model || this.defaultModel,
        maxTokens: 8,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** À implémenter par chaque fournisseur : un appel avec UNE clé donnée. */
  // eslint-disable-next-line no-unused-vars
  async _completeWithKey(messages, options) {
    throw new Error(`_completeWithKey() non implémenté pour ${this.name}`);
  }
}

module.exports = AIProvider;
