const whatsapp = require('../../src/channels/WhatsAppAdapter');
const { getDb, resetDb } = require('../../src/db/database');

const db = getDb();
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

afterAll(() => resetDb());

describe('WhatsAppAdapter — un numéro WhatsApp = UN SEUL agent', () => {
  test('re-scanner le même téléphone depuis un nouvel agent déconnecte l\'ancien', async () => {
    const org = await db.organization.create({
      data: { name: 'Org WA', owner_email: `wa-${uniq()}@test.ma`, owner_password: 'hash' },
    });
    // l'ancien agent est lié au numéro et croit être connecté
    const oldAgent = await db.agent.create({
      data: { org_id: org.id, name: 'Ancienne agence', whatsapp_number: '212600112233', whatsapp_status: 'connected' },
    });
    const newAgent = await db.agent.create({
      data: { org_id: org.id, name: 'Nouvelle agence' },
    });

    // le même téléphone scanne le QR du nouvel agent
    await whatsapp._enforceSingleAgentPerNumber(newAgent.id, '212600112233');

    const updatedNew = await db.agent.findUnique({ where: { id: newAgent.id } });
    expect(updatedNew.whatsapp_number).toBe('212600112233');

    // l'ancien agent ne doit PLUS répondre sur ce numéro
    const updatedOld = await db.agent.findUnique({ where: { id: oldAgent.id } });
    expect(updatedOld.whatsapp_number).toBeNull();
    expect(updatedOld.whatsapp_status).toBe('disconnected');
    expect(whatsapp.getStatus(oldAgent.id)).toBe('disconnected');
  });

  test('aucun doublon : rien d\'autre n\'est déconnecté', async () => {
    const org = await db.organization.create({
      data: { name: 'Org WA2', owner_email: `wa-${uniq()}@test.ma`, owner_password: 'hash' },
    });
    const other = await db.agent.create({
      data: { org_id: org.id, name: 'Autre numéro', whatsapp_number: '212699887766', whatsapp_status: 'connected' },
    });
    const agent = await db.agent.create({ data: { org_id: org.id, name: 'Agent' } });

    await whatsapp._enforceSingleAgentPerNumber(agent.id, '212611112222');

    const untouched = await db.agent.findUnique({ where: { id: other.id } });
    expect(untouched.whatsapp_number).toBe('212699887766');
    expect(untouched.whatsapp_status).toBe('connected');
  });
});
