const request = require('supertest');
const fs = require('fs');
const { createApp } = require('../../src/app');
const WebsiteSource = require('../../src/datasources/WebsiteSource');

const app = createApp();

/**
 * Wizard « source site web » de bout en bout via l'API (fetch mocké) :
 * analyze détecte le type depuis la référence, crawle le site, sauvegarde le
 * mapping ; preview sert le catalogue extrait.
 */
const PAGES = {
  'https://garage.ma/': {
    type: 'text/html',
    body: `<html><head><title>Garage Atlas</title>
      <meta property="og:site_name" content="Garage Atlas" />
      <script type="application/ld+json">
      {"@type":"Product","name":"Vidange complète","description":"Huile + filtre",
       "offers":{"price":"350","priceCurrency":"MAD"}}
      </script></head>
      <body><a href="mailto:hello@garage.ma">Contact</a></body></html>`,
  },
};

const realFetch = global.fetch;

describe('Source site web — wizard API de bout en bout (fetch mocké)', () => {
  let token;
  let agent;

  beforeAll(async () => {
    WebsiteSource.clearCache();
    fs.rmSync(process.env.WEBCACHE_DIR, { recursive: true, force: true });
    global.fetch = jest.fn(async (url) => {
      const page = PAGES[String(url)];
      if (!page) return { ok: false, status: 404, headers: { get: () => 'text/html' }, text: async () => '', json: async () => ({}) };
      return { ok: true, status: 200, headers: { get: () => page.type }, text: async () => page.body, json: async () => JSON.parse(page.body) };
    });

    const email = `web-${Date.now()}@test.ma`;
    token = (
      await request(app)
        .post('/api/register')
        .send({ orgName: 'Org Web', email, password: 'motdepasse123' })
    ).body.token;

    agent = (
      await request(app)
        .post('/api/agents')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Bot Garage', description: 'Garage auto' })
    ).body;
  });

  afterAll(() => {
    global.fetch = realFetch;
    fs.rmSync(process.env.WEBCACHE_DIR, { recursive: true, force: true });
  });

  test('analyze : type « website » déduit du domaine, crawl et rapport', async () => {
    const resp = await request(app)
      .post(`/api/agents/${agent.id}/datasource/analyze`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ref: 'garage.ma' });

    expect(resp.status).toBe(200);
    expect(resp.body.source).toBe('website');
    expect(resp.body.siteName).toBe('Garage Atlas');
    expect(resp.body.stats.productsFound).toBe(1);
    expect(resp.body.stats.emails).toContain('hello@garage.ma');
    expect(resp.body.sample[0].name).toBe('Vidange complète');
    expect(resp.body.sample[0].price).toBe('350 MAD');

    // le type et la référence sont sauvegardés sur l'agent
    const updated = (
      await request(app).get(`/api/agents/${agent.id}`).set('Authorization', `Bearer ${token}`)
    ).body;
    expect(updated.data_source_type).toBe('website');
    expect(updated.source_ref).toBe('garage.ma');
    expect(updated.sheet_analysis.stats.pagesCrawled).toBe(1);
  });

  test('mapping confirmé puis preview servie depuis le cache (pas de re-crawl)', async () => {
    const confirm = await request(app)
      .post(`/api/agents/${agent.id}/datasource/mapping`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mapping: { name: 'name', price: 'price' } });
    expect(confirm.status).toBe(200);
    expect(confirm.body.confirmedAt).toBeTruthy();

    const callsBefore = global.fetch.mock.calls.length;
    const preview = await request(app)
      .get(`/api/agents/${agent.id}/datasource/preview?limit=5`)
      .set('Authorization', `Bearer ${token}`);

    expect(preview.status).toBe(200);
    expect(preview.body.total).toBeGreaterThanOrEqual(2); // produit + contact + page
    expect(preview.body.rows[0].type).toBe('produit');
    expect(preview.body.stats.productsFound).toBe(1);
    expect(global.fetch.mock.calls.length).toBe(callsBefore); // cache : zéro requête
  });

  test('une URL Google Sheets reste détectée comme google_sheets', async () => {
    // fetch mocké : le CSV de la feuille
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/csv' },
      text: async () => 'Nom,Prix\nLogan,250\n',
      json: async () => ({}),
    }));

    const resp = await request(app)
      .post(`/api/agents/${agent.id}/datasource/analyze`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ref: 'https://docs.google.com/spreadsheets/d/abc123/edit' });

    expect(resp.status).toBe(200);
    expect(resp.body.source).toBe('google_sheets');
    expect(resp.body.headers).toEqual(['Nom', 'Prix']);
  });
});
