/**
 * Registre / fabrique des sources de données.
 * Contrairement aux canaux (singletons), une source est instanciée à la demande
 * avec la config de l'agent : create('google_sheets', { ref: url }).
 *
 * Pour activer une nouvelle source (Phase 2) :
 *   registry.register('excel', (config) => new ExcelSource(config));
 */
class DataSourceRegistry {
  constructor() {
    this.factories = new Map();
  }

  register(type, factory) {
    this.factories.set(type, factory);
  }

  create(type, config) {
    const factory = this.factories.get(type);
    if (!factory) {
      const err = new Error(`Source de données inconnue ou non activée : ${type}`);
      err.status = 400;
      throw err;
    }
    return factory(config);
  }

  list() {
    return [...this.factories.keys()];
  }
}

const registry = new DataSourceRegistry();

const GoogleSheetsSource = require('./GoogleSheetsSource');
registry.register('google_sheets', (config) => new GoogleSheetsSource(config));
// Phase 2 : registry.register('excel', (config) => new ExcelSource(config));
// Phase 2 : registry.register('pdf', (config) => new PdfSource(config));
// Phase 2 : registry.register('website', (config) => new WebsiteSource(config));

module.exports = registry;
