const AIProvider = require('../../src/ai/AIProvider');

/** Doublure : échoue pour toute clé commençant par 'bad', répond sinon. */
class FakeProvider extends AIProvider {
  constructor() {
    super('fake', 'fake-model');
    this.calls = [];
  }

  async _completeWithKey(messages, { apiKey }) {
    this.calls.push(apiKey);
    if (apiKey.startsWith('bad')) throw new Error('quota dépassé');
    return `réponse via ${apiKey}`;
  }
}

describe('AIProvider — logique de repli multi-clés', () => {
  test('utilise la clé primaire quand elle fonctionne', async () => {
    const p = new FakeProvider();
    const out = await p.complete([{ role: 'user', content: 'salut' }], { keys: ['good-1', 'good-2'] });
    expect(out).toBe('réponse via good-1');
    expect(p.calls).toEqual(['good-1']);
  });

  test('bascule sur la clé suivante en cas d\'échec', async () => {
    const p = new FakeProvider();
    const out = await p.complete([{ role: 'user', content: 'salut' }], { keys: ['bad-1', 'bad-2', 'good-3'] });
    expect(out).toBe('réponse via good-3');
    expect(p.calls).toEqual(['bad-1', 'bad-2', 'good-3']);
  });

  test('échec de toutes les clés : erreur explicite', async () => {
    const p = new FakeProvider();
    await expect(
      p.complete([{ role: 'user', content: 'salut' }], { keys: ['bad-1', 'bad-2'] })
    ).rejects.toThrow(/Toutes les clés fake ont échoué/);
  });

  test('aucune clé configurée : erreur 422', async () => {
    const p = new FakeProvider();
    await expect(p.complete([], { keys: [] })).rejects.toThrow(/Aucune clé/);
  });

  test('les clés vides / null sont ignorées', async () => {
    const p = new FakeProvider();
    const out = await p.complete([], { keys: ['', null, 'good-1'] });
    expect(out).toBe('réponse via good-1');
  });

  test('test() retourne true/false sans lever d\'exception', async () => {
    const p = new FakeProvider();
    await expect(p.test('good-key')).resolves.toBe(true);
    await expect(p.test('bad-key')).resolves.toBe(false);
  });
});
