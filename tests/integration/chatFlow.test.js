const request = require('supertest');
const { createApp } = require('../../src/app');
const { getDb } = require('../../src/db/database');
const chatEngine = require('../../src/services/chatEngine');
const aiRegistry = require('../../src/ai/AIRegistry');
const groq = require('../../src/ai/GroqProvider');

const app = createApp();

/**
 * Flux de bout en bout SANS réseau : message entrant normalisé -> moteur ->
 * (IA mockée) -> réponse + transaction enregistrée + historique sauvegardé.
 */
describe('Moteur de conversation — bout en bout (IA mockée)', () => {
  let token;
  let agent;
  let originalComplete;

  beforeAll(async () => {
    const email = `chat-${Date.now()}@test.ma`;
    token = (
      await request(app)
        .post('/api/register')
        .send({ orgName: 'Org Chat', email, password: 'motdepasse123' })
    ).body.token;

    agent = (
      await request(app)
        .post('/api/agents')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Bot Atlas', description: 'Location de voitures' })
    ).body;

    await request(app)
      .patch(`/api/agents/${agent.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ai_provider: 'groq', ai_tokens: ['cle-mockee'] });

    // mock du fournisseur : aucune requête réseau
    originalComplete = groq._completeWithKey;
    groq._completeWithKey = async () =>
      'Réservation confirmée pour la Dacia Logan !\n```json\n{"action": "reservation", "data": {"vehicule": "Dacia Logan", "jours": 2}}\n```';
  });

  afterAll(() => {
    groq._completeWithKey = originalComplete;
  });

  test('le registre IA expose bien groq et gemini', () => {
    expect(aiRegistry.list().sort()).toEqual(['gemini', 'groq']);
  });

  test('message entrant -> réponse IA, transaction créée, historique persisté', async () => {
    const reply = await chatEngine.handleInboundMessage({
      agentId: agent.id,
      channel: 'whatsapp',
      customerId: '212600000001@s.whatsapp.net',
      customerName: 'Ali',
      text: 'Je confirme la réservation de la Logan pour 2 jours',
    });

    expect(reply.text).toContain('Réservation confirmée');
    expect(reply.text).not.toContain('```'); // le bloc JSON ne part jamais au client

    // transaction visible via l'API (filtrée par organisation)
    const txs = await request(app)
      .get(`/api/agents/${agent.id}/transactions`)
      .set('Authorization', `Bearer ${token}`);
    expect(txs.body).toHaveLength(1);
    expect(txs.body[0].transaction_type).toBe('reservation');
    expect(txs.body[0].data.vehicule).toBe('Dacia Logan');
    expect(txs.body[0].status).toBe('pending');

    // historique sauvegardé
    const conv = await getDb().conversation.findFirst({ where: { agent_id: agent.id } });
    const messages = JSON.parse(conv.messages);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  test('changement de statut + export CSV', async () => {
    const txs = await request(app)
      .get(`/api/agents/${agent.id}/transactions`)
      .set('Authorization', `Bearer ${token}`);
    const tx = txs.body[0];

    const patched = await request(app)
      .patch(`/api/transactions/${tx.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'confirmed' });
    expect(patched.status).toBe(200);

    const csv = await request(app)
      .get(`/api/agents/${agent.id}/transactions/export.csv`)
      .set('Authorization', `Bearer ${token}`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('vehicule');
    expect(csv.text).toContain('Dacia Logan');
    expect(csv.text).toContain('confirmed');
  });

  test('quota IA dépassé : message de repli poli, jamais de silence', async () => {
    const reservationMock = groq._completeWithKey;
    groq._completeWithKey = async () => {
      throw new Error('Groq HTTP 429 : rate limit reached');
    };
    try {
      const reply = await chatEngine.handleInboundMessage({
        agentId: agent.id,
        customerId: '212600000003@s.whatsapp.net',
        text: 'Bonjour, vous avez des voitures ?',
      });
      expect(reply.text).toBe(chatEngine.FALLBACK_REPLY);
    } finally {
      groq._completeWithKey = reservationMock;
    }
  });

  test('agent en pause : le moteur ne répond pas', async () => {
    await request(app)
      .patch(`/api/agents/${agent.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'paused' });

    const reply = await chatEngine.handleInboundMessage({
      agentId: agent.id,
      customerId: '212600000002@s.whatsapp.net',
      text: 'Bonjour ?',
    });
    expect(reply).toBeNull();
  });
});
