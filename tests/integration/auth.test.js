const request = require('supertest');
const { createApp } = require('../../src/app');

const app = createApp();
const unique = () => `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.ma`;

describe('Inscription & authentification', () => {
  test('register : crée l\'organisation + le propriétaire et renvoie un jeton', async () => {
    const email = unique();
    const resp = await request(app)
      .post('/api/register')
      .send({ orgName: 'Atlas Location', email, password: 'motdepasse123' });

    expect(resp.status).toBe(201);
    expect(resp.body.token).toBeTruthy();
    expect(resp.body.org.name).toBe('Atlas Location');
    expect(resp.body.org.plan).toBe('starter');
  });

  test('register : champs manquants -> 400', async () => {
    const resp = await request(app).post('/api/register').send({ email: unique() });
    expect(resp.status).toBe(400);
  });

  test('register : mot de passe trop court -> 400', async () => {
    const resp = await request(app)
      .post('/api/register')
      .send({ orgName: 'X', email: unique(), password: 'court' });
    expect(resp.status).toBe(400);
  });

  test('register : e-mail déjà utilisé -> 409', async () => {
    const email = unique();
    await request(app).post('/api/register').send({ orgName: 'A', email, password: 'motdepasse123' });
    const resp = await request(app).post('/api/register').send({ orgName: 'B', email, password: 'motdepasse123' });
    expect(resp.status).toBe(409);
  });

  test('login : identifiants valides -> jeton + organisation', async () => {
    const email = unique();
    await request(app).post('/api/register').send({ orgName: 'A', email, password: 'motdepasse123' });
    const resp = await request(app).post('/api/login').send({ email, password: 'motdepasse123' });
    expect(resp.status).toBe(200);
    expect(resp.body.token).toBeTruthy();
    expect(resp.body.org.id).toBeTruthy();
  });

  test('login : mauvais mot de passe -> 401', async () => {
    const email = unique();
    await request(app).post('/api/register').send({ orgName: 'A', email, password: 'motdepasse123' });
    const resp = await request(app).post('/api/login').send({ email, password: 'mauvais-mdp' });
    expect(resp.status).toBe(401);
  });

  test('route privée sans jeton -> 401', async () => {
    const resp = await request(app).get('/api/agents');
    expect(resp.status).toBe(401);
  });

  test('route privée avec jeton invalide -> 401', async () => {
    const resp = await request(app).get('/api/agents').set('Authorization', 'Bearer faux-jeton');
    expect(resp.status).toBe(401);
  });
});
