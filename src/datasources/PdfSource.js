const DataSource = require('./DataSource');

/**
 * Phase 2 — Brochures / menus PDF.
 * Plan : extraction du texte (ex. lib `pdf-parse`), découpage en segments,
 * indexation via ragService, puis search() = récupération top-k.
 * Enregistrer ensuite la source dans DataSourceRegistry.js.
 */
class PdfSource extends DataSource {
  constructor(config = {}) {
    super('pdf', config);
  }
}

module.exports = PdfSource;
