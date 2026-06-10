/**
 * Registre des fournisseurs d'IA.
 * Pour ajouter un fournisseur : créer une sous-classe d'AIProvider qui
 * implémente _completeWithKey(), puis l'enregistrer ici.
 */
const providers = new Map();
providers.set('groq', require('./GroqProvider'));
providers.set('gemini', require('./GeminiProvider'));

module.exports = {
  get(name) {
    const provider = providers.get(name);
    if (!provider) {
      const err = new Error(`Fournisseur d'IA inconnu : ${name}`);
      err.status = 400;
      throw err;
    }
    return provider;
  },
  list() {
    return [...providers.keys()];
  },
};
