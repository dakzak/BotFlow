/**
 * Contrat commun à TOUTES les sources de données (cahier des charges §6.4.2).
 *
 * Une source (Google Sheets, Excel, PDF, Site web) sait :
 *  - analyze()      : détecter sa structure (colonnes / contenu / sens) ;
 *  - fetchPreview() : fournir un aperçu pour le dashboard ;
 *  - search()       : renvoyer le contexte pertinent pour une question client ;
 *  - write()        : optionnel, écrire un enregistrement (ex. réservation).
 *
 * Le moteur de conversation ne sait pas d'où viennent les informations.
 */
class DataSource {
  constructor(type, config = {}) {
    if (!type) throw new Error('Une DataSource doit avoir un type');
    this.type = type;
    this.config = config;
  }

  async analyze() {
    throw new Error(`analyze() non implémenté pour la source ${this.type}`);
  }

  // eslint-disable-next-line no-unused-vars
  async fetchPreview(limit) {
    throw new Error(`fetchPreview() non implémenté pour la source ${this.type}`);
  }

  // eslint-disable-next-line no-unused-vars
  async search(query, options) {
    throw new Error(`search() non implémenté pour la source ${this.type}`);
  }

  // eslint-disable-next-line no-unused-vars
  async write(record) {
    throw new Error(`write() non disponible pour la source ${this.type}`);
  }
}

module.exports = DataSource;
