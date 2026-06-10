const DataSource = require('./DataSource');

/**
 * Phase 2 — Site web de l'organisation (crawl + RAG).
 * Plan : exploration des pages autorisées, extraction du contenu, découpage
 * en segments, vectorisation (embeddings) dans un index PAR AGENT via
 * ragService, puis search() = récupération top-k injectée dans le prompt.
 * Enregistrer ensuite la source dans DataSourceRegistry.js.
 */
class WebsiteSource extends DataSource {
  constructor(config = {}) {
    super('website', config);
  }
}

module.exports = WebsiteSource;
