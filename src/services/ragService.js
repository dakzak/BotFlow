/**
 * Phase 2 — Recherche augmentée par génération (RAG).
 *
 * Plan :
 *  - index(agentId, segments)  : vectoriser (embeddings) et stocker PAR AGENT
 *    (extension vectorielle SQLite ou base vectorielle dédiée) ;
 *  - query(agentId, question, topK) : récupérer les segments les plus
 *    pertinents à injecter dans le prompt du moteur de conversation.
 *
 * Utilisé par PdfSource et WebsiteSource ; le moteur, lui, ne change pas :
 * il appelle toujours source.search(query) quelle que soit la technique.
 */

async function index(agentId, segments) {
  throw new Error('ragService.index — Phase 2, non implémenté');
}

async function query(agentId, question, topK = 5) {
  throw new Error('ragService.query — Phase 2, non implémenté');
}

module.exports = { index, query };
