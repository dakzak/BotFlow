const { getDb, resetDb } = require('../../src/db/database');

const db = getDb();
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function seedOrg(name = 'Org Test') {
  return db.organization.create({
    data: { name, owner_email: `org-${uniq()}@test.ma`, owner_password: 'hash' },
  });
}

afterAll(() => resetDb());

describe('Modèle de données (Prisma)', () => {
  test('valeurs par défaut : plan starter, agent actif, whatsapp déconnecté', async () => {
    const org = await seedOrg();
    expect(org.plan).toBe('starter');
    expect(org.max_agents).toBe(3);
    expect(org.id).toBeTruthy(); // UUID généré

    const agent = await db.agent.create({ data: { org_id: org.id, name: 'Bot' } });
    expect(agent.status).toBe('active');
    expect(agent.whatsapp_status).toBe('disconnected');
    expect(agent.ai_tokens).toBe('[]');
    expect(agent.business_type).toBe('other');
  });

  test('isolation : une requête filtrée par org_id ne voit pas les agents d\'une autre org', async () => {
    const orgA = await seedOrg('Org A');
    const orgB = await seedOrg('Org B');
    await db.agent.create({ data: { org_id: orgA.id, name: 'Agent A' } });

    expect(await db.agent.count({ where: { org_id: orgB.id } })).toBe(0);
    expect(await db.agent.count({ where: { org_id: orgA.id } })).toBe(1);
  });

  test('unicité : deux membres ne peuvent pas partager le même e-mail', async () => {
    const org = await seedOrg();
    const email = `double-${uniq()}@test.ma`;
    await db.member.create({ data: { org_id: org.id, email, password: 'hash' } });
    await expect(
      db.member.create({ data: { org_id: org.id, email, password: 'hash' } })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  test('une seule conversation par (agent, canal, client) — contrainte composite', async () => {
    const org = await seedOrg();
    const agent = await db.agent.create({ data: { org_id: org.id, name: 'Bot' } });
    const data = {
      agent_id: agent.id, org_id: org.id, channel: 'whatsapp',
      customer_id: '212600000000@s.whatsapp.net',
    };
    await db.conversation.create({ data });
    await expect(db.conversation.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  test('suppression en cascade : supprimer une org supprime agents et conversations', async () => {
    const org = await seedOrg();
    const agent = await db.agent.create({ data: { org_id: org.id, name: 'Bot' } });
    await db.conversation.create({
      data: {
        agent_id: agent.id, org_id: org.id,
        customer_id: '212611111111@s.whatsapp.net',
      },
    });

    await db.organization.delete({ where: { id: org.id } });
    expect(await db.agent.count({ where: { org_id: org.id } })).toBe(0);
    expect(await db.conversation.count({ where: { org_id: org.id } })).toBe(0);
  });
});
