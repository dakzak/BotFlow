/**
 * Tests de contrat : chaque module enfichable respecte son interface
 * (cahier des charges §8 — « chaque ChannelAdapter / DataSource / AIProvider
 * passe une même suite de tests vérifiant le respect du contrat »).
 */
const channelRegistry = require('../../src/channels/ChannelRegistry');
const dataSourceRegistry = require('../../src/datasources/DataSourceRegistry');
const aiRegistry = require('../../src/ai/AIRegistry');
const ChannelAdapter = require('../../src/channels/ChannelAdapter');
const DataSource = require('../../src/datasources/DataSource');
const AIProvider = require('../../src/ai/AIProvider');

const CHANNEL_METHODS = ['start', 'stop', 'getStatus', 'getAuthArtifact', 'sendMessage', 'sendMedia', 'onInboundMessage', 'clearSession'];
const DATASOURCE_METHODS = ['analyze', 'fetchPreview', 'search', 'write'];
const AI_METHODS = ['complete', 'test', '_completeWithKey'];

describe('Contrat ChannelAdapter', () => {
  test('au moins le canal whatsapp est enregistré', () => {
    expect(channelRegistry.list().map((a) => a.name)).toContain('whatsapp');
  });

  test.each(channelRegistry.list().map((a) => [a.name, a]))(
    'le canal "%s" expose toutes les méthodes du contrat',
    (name, adapter) => {
      expect(adapter).toBeInstanceOf(ChannelAdapter);
      for (const m of CHANNEL_METHODS) {
        expect(typeof adapter[m]).toBe('function');
      }
    }
  );

  test('un canal non enregistré lève une erreur 400 explicite', () => {
    expect(() => channelRegistry.get('pigeon-voyageur')).toThrow(/Canal inconnu/);
  });

  test('les messages entrants passent par le handler normalisé', async () => {
    const whatsapp = channelRegistry.get('whatsapp');
    let received = null;
    whatsapp.onInboundMessage(async (msg) => { received = msg; });
    await whatsapp._emitInbound({ agentId: 'a1', customerId: 'c1', text: 'salut' });
    expect(received).toEqual({ channel: 'whatsapp', agentId: 'a1', customerId: 'c1', text: 'salut' });
    whatsapp.onInboundMessage(null);
  });
});

describe('Contrat DataSource', () => {
  test('au moins la source google_sheets est enregistrée', () => {
    expect(dataSourceRegistry.list()).toContain('google_sheets');
  });

  test.each(dataSourceRegistry.list())('la source "%s" expose toutes les méthodes du contrat', (type) => {
    const source = dataSourceRegistry.create(type, { ref: 'https://docs.google.com/spreadsheets/d/x123' });
    expect(source).toBeInstanceOf(DataSource);
    for (const m of DATASOURCE_METHODS) {
      expect(typeof source[m]).toBe('function');
    }
  });

  test('une source non enregistrée lève une erreur 400 explicite', () => {
    expect(() => dataSourceRegistry.create('pierre-gravee', {})).toThrow(/Source de données inconnue/);
  });
});

describe('Contrat AIProvider', () => {
  test('groq et gemini sont enregistrés', () => {
    expect(aiRegistry.list().sort()).toEqual(['gemini', 'groq']);
  });

  test.each(aiRegistry.list())('le fournisseur "%s" expose toutes les méthodes du contrat', (name) => {
    const provider = aiRegistry.get(name);
    expect(provider).toBeInstanceOf(AIProvider);
    expect(provider.defaultModel).toBeTruthy();
    for (const m of AI_METHODS) {
      expect(typeof provider[m]).toBe('function');
    }
  });

  test('un fournisseur non enregistré lève une erreur 400 explicite', () => {
    expect(() => aiRegistry.get('boule-de-cristal')).toThrow(/Fournisseur d'IA inconnu/);
  });
});
