const request = require('supertest');
const { createApp } = require('../../src/app');
const { getDb } = require('../../src/db/database');
const chatEngine = require('../../src/services/chatEngine');
const groq = require('../../src/ai/GroqProvider');

const app = createApp();

/** Réponse IA mockée : confirmation de réservation avec dates structurées. */
const aiConfirm = (item, start, end) =>
  `Réservation confirmée pour ${item} du ${start} au ${end} !\n` +
  '```json\n' +
  JSON.stringify({ action: 'reservation', data: { item, start_date: start, end_date: end } }) +
  '\n```';

/** Dates relatives à aujourd'hui pour que les réservations soient « à venir ». */
const plusDays = (n) => {
  const d = new Date(Date.now() + n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};

/**
 * Disponibilité des réservations (cahier des charges : location de voitures) :
 * une réservation chevauchant une réservation active du même véhicule est
 * refusée, et le client est informé de la prochaine date de disponibilité.
 */
describe('Réservations — contrôle de disponibilité par dates (IA mockée)', () => {
  let token;
  let agent;
  let originalComplete;

  const countTransactions = async () =>
    (
      await request(app)
        .get(`/api/agents/${agent.id}/transactions`)
        .set('Authorization', `Bearer ${token}`)
    ).body;

  beforeAll(async () => {
    const email = `dispo-${Date.now()}@test.ma`;
    token = (
      await request(app)
        .post('/api/register')
        .send({ orgName: 'Org Dispo', email, password: 'motdepasse123' })
    ).body.token;

    agent = (
      await request(app)
        .post('/api/agents')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Bot Atlas', description: 'Location de voitures', business_type: 'car_rental' })
    ).body;

    await request(app)
      .patch(`/api/agents/${agent.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ai_provider: 'groq', ai_tokens: ['cle-mockee'] });

    originalComplete = groq._completeWithKey;
  });

  afterAll(() => {
    groq._completeWithKey = originalComplete;
  });

  test('première réservation avec dates : enregistrée avec item / start_date / end_date', async () => {
    groq._completeWithKey = async () => aiConfirm('Dacia Logan', plusDays(2), plusDays(5));

    const reply = await chatEngine.handleInboundMessage({
      agentId: agent.id,
      customerId: '212600000010@s.whatsapp.net',
      customerName: 'Ali',
      text: `Je confirme la Logan du ${plusDays(2)} au ${plusDays(5)}`,
    });

    expect(reply.text).toContain('Réservation confirmée');
    const txs = await countTransactions();
    expect(txs).toHaveLength(1);
    expect(txs[0].data.item).toBe('Dacia Logan');
    expect(txs[0].data.start_date).toBe(plusDays(2));
    expect(txs[0].data.end_date).toBe(plusDays(5));
  });

  test('le prompt suivant expose la réservation existante à l\'IA', async () => {
    let promptVu = null;
    groq._completeWithKey = async (messages) => {
      promptVu = messages[0].content;
      return 'La Logan est déjà réservée sur ces dates.';
    };

    await chatEngine.handleInboundMessage({
      agentId: agent.id,
      customerId: '212600000011@s.whatsapp.net',
      text: 'La Logan est libre cette semaine ?',
    });

    expect(promptVu).toContain('RÉSERVATIONS DÉJÀ ENREGISTRÉES');
    expect(promptVu).toContain(`Dacia Logan | ${plusDays(2)} | ${plusDays(5)}`);
  });

  test('chevauchement : la transaction est refusée et le client reçoit la date de disponibilité', async () => {
    // l'IA confirme à tort malgré le prompt : le garde-fou serveur doit bloquer
    groq._completeWithKey = async () => aiConfirm('Dacia Logan', plusDays(4), plusDays(7));

    const reply = await chatEngine.handleInboundMessage({
      agentId: agent.id,
      customerId: '212600000012@s.whatsapp.net',
      customerName: 'Sara',
      text: `Je confirme la Logan du ${plusDays(4)} au ${plusDays(7)}`,
    });

    expect(reply.text).toContain('déjà réservé');
    expect(reply.text).toContain(plusDays(6)); // lendemain de la fin existante
    expect(await countTransactions()).toHaveLength(1); // rien d'enregistré
  });

  test('période libre après la réservation existante : acceptée', async () => {
    groq._completeWithKey = async () => aiConfirm('Dacia Logan', plusDays(6), plusDays(9));

    const reply = await chatEngine.handleInboundMessage({
      agentId: agent.id,
      customerId: '212600000012@s.whatsapp.net',
      customerName: 'Sara',
      text: `D'accord, alors du ${plusDays(6)} au ${plusDays(9)}`,
    });

    expect(reply.text).toContain('Réservation confirmée');
    expect(await countTransactions()).toHaveLength(2);
  });

  test('autre véhicule sur les mêmes dates : accepté', async () => {
    groq._completeWithKey = async () => aiConfirm('Renault Clio', plusDays(2), plusDays(5));

    const reply = await chatEngine.handleInboundMessage({
      agentId: agent.id,
      customerId: '212600000013@s.whatsapp.net',
      text: `Je confirme la Clio du ${plusDays(2)} au ${plusDays(5)}`,
    });

    expect(reply.text).toContain('Réservation confirmée');
    expect(await countTransactions()).toHaveLength(3);
  });

  test('réservation annulée : le véhicule redevient réservable', async () => {
    const txs = await countTransactions();
    const logan1 = txs.find((t) => t.data.item === 'Dacia Logan' && t.data.start_date === plusDays(2));
    await request(app)
      .patch(`/api/transactions/${logan1.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'cancelled' });

    groq._completeWithKey = async () => aiConfirm('Dacia Logan', plusDays(2), plusDays(5));
    const reply = await chatEngine.handleInboundMessage({
      agentId: agent.id,
      customerId: '212600000014@s.whatsapp.net',
      text: `Je confirme la Logan du ${plusDays(2)} au ${plusDays(5)}`,
    });

    expect(reply.text).toContain('Réservation confirmée');
    expect(await countTransactions()).toHaveLength(4);
  });
});
