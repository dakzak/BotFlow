const request = require('supertest');
const { createApp } = require('../../src/app');

const app = createApp();

async function createOrg(name) {
  const email = `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.ma`;
  const resp = await request(app)
    .post('/api/register')
    .send({ orgName: name, email, password: 'motdepasse123' });
  return resp.body.token;
}

describe('Agents — CRUD et isolation multi-organisation', () => {
  test('création d\'un agent puis lecture', async () => {
    const token = await createOrg('Org Agents');
    const created = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bot Ventes', description: 'Location de voitures à Casablanca' });

    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();
    expect(created.body.status).toBe('active');

    const list = await request(app).get('/api/agents').set('Authorization', `Bearer ${token}`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe('Bot Ventes');
  });

  test('ISOLATION : l\'organisation B ne voit pas et ne modifie pas l\'agent de A', async () => {
    const tokenA = await createOrg('Org A');
    const tokenB = await createOrg('Org B');

    const agent = (
      await request(app)
        .post('/api/agents')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Agent secret de A' })
    ).body;

    const listB = await request(app).get('/api/agents').set('Authorization', `Bearer ${tokenB}`);
    expect(listB.body).toHaveLength(0);

    const readB = await request(app)
      .get(`/api/agents/${agent.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(readB.status).toBe(404);

    const patchB = await request(app)
      .patch(`/api/agents/${agent.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'piraté' });
    expect(patchB.status).toBe(404);

    // l'agent de A est intact
    const readA = await request(app)
      .get(`/api/agents/${agent.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(readA.body.name).toBe('Agent secret de A');
  });

  test('quota : impossible de dépasser max_agents (3 en starter)', async () => {
    const token = await createOrg('Org Quota');
    for (let i = 1; i <= 3; i++) {
      const r = await request(app)
        .post('/api/agents')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Agent ${i}` });
      expect(r.status).toBe(201);
    }
    const fourth = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Agent 4' });
    expect(fourth.status).toBe(403);
    expect(fourth.body.error).toMatch(/Quota/);
  });

  test('les clés d\'API ne sont JAMAIS renvoyées au frontend', async () => {
    const token = await createOrg('Org Secrets');
    const agent = (
      await request(app)
        .post('/api/agents')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Bot' })
    ).body;

    const patched = await request(app)
      .patch(`/api/agents/${agent.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ai_tokens: ['gsk_cle_tres_secrete', 'gsk_secours'], ai_provider: 'groq' });

    expect(patched.status).toBe(200);
    expect(patched.body.ai_tokens).toBeUndefined();
    expect(patched.body.ai_keys_count).toBe(2);
    expect(JSON.stringify(patched.body)).not.toContain('gsk_cle_tres_secrete');
  });

  test('mise à jour refusée hors liste blanche (org_id non modifiable)', async () => {
    const token = await createOrg('Org Whitelist');
    const agent = (
      await request(app)
        .post('/api/agents')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Bot' })
    ).body;

    const resp = await request(app)
      .patch(`/api/agents/${agent.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ org_id: 'autre-org' });
    expect(resp.status).toBe(400); // aucun champ autorisé fourni
  });
});
