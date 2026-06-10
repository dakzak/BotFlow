const DataSource = require('./DataSource');

/**
 * Phase 2 — Catalogue Excel / CSV importé.
 * Plan : upload du fichier, parsing en tableau (ex. lib `xlsx`), puis
 * réutiliser le même mapping de colonnes que GoogleSheetsSource
 * (guessColumnMeaning est exporté et réutilisable).
 * Enregistrer ensuite la source dans DataSourceRegistry.js.
 */
class ExcelSource extends DataSource {
  constructor(config = {}) {
    super('excel', config);
  }
}

module.exports = ExcelSource;
