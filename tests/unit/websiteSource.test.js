const fs = require('fs');
const path = require('path');
const WebsiteSource = require('../../src/datasources/WebsiteSource');

const {
  normalizeStartUrl,
  isAllowedHost,
  isSafeHost,
  apexOf,
  extractJsonLd,
  productsFromJsonLd,
  productFromOpenGraph,
  categoriesFromBreadcrumbs,
  parseRobots,
  htmlToText,
} = WebsiteSource;

/* ------------------------------------------------------------------ */
/* Faux site « atlasrent.ma » servi par un fetch mocké (zéro réseau)   */
/* ------------------------------------------------------------------ */

const SITE = {
  'https://atlasrent.ma/robots.txt': {
    type: 'text/plain',
    body: 'User-agent: *\nDisallow: /prive\n',
  },
  'https://atlasrent.ma/sitemap.xml': {
    type: 'application/xml',
    body: `<?xml version="1.0"?><urlset>
      <url><loc>https://atlasrent.ma/voitures</loc></url>
      <url><loc>https://atlasrent.ma/voitures/dacia-logan</loc></url>
    </urlset>`,
  },
  'https://atlasrent.ma/': {
    type: 'text/html',
    body: `<html><head>
      <title>Atlas Rent — Location de voitures à Casablanca</title>
      <meta property="og:site_name" content="Atlas Rent" />
      <meta name="description" content="Location de voitures pas cher à Casablanca." />
    </head><body>
      <a href="/voitures">Nos voitures</a>
      <a href="/contact">Contact</a>
      <a href="https://shop.atlasrent.ma/promo">Promos</a>
      <a href="https://facebook.com/atlasrent">Facebook</a>
      <a href="/cart">Panier</a>
      <a href="/prive/secret">Privé</a>
      <a href="mailto:contact@atlasrent.ma">Écrivez-nous</a>
      <a href="tel:+212 522-123456">Appelez-nous</a>
    </body></html>`,
  },
  'https://atlasrent.ma/voitures': {
    type: 'text/html',
    body: `<html><head><title>Nos voitures</title>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"BreadcrumbList","itemListElement":[
          {"@type":"ListItem","position":1,"name":"Accueil"},
          {"@type":"ListItem","position":2,"name":"Citadines"},
          {"@type":"ListItem","position":3,"name":"Liste"}
        ]},
        {"@type":"ItemList","itemListElement":[
          {"@type":"ListItem","item":{"@type":"Product","name":"Dacia Logan",
            "image":"https://atlasrent.ma/img/logan.jpg","category":"Citadines",
            "url":"https://atlasrent.ma/voitures/dacia-logan",
            "offers":{"@type":"Offer","price":"250","priceCurrency":"MAD","availability":"https://schema.org/InStock"}}},
          {"@type":"ListItem","item":{"@type":"Product","name":"Renault Clio",
            "offers":{"@type":"Offer","price":"300","priceCurrency":"MAD"}}}
        ]}
      ]}
      </script></head>
      <body><a href="/voitures/dacia-logan">Dacia Logan</a></body></html>`,
  },
  'https://atlasrent.ma/voitures/dacia-logan': {
    type: 'text/html',
    body: `<html><head><title>Dacia Logan</title>
      <script type="application/ld+json">
      {"@type":"Product","name":"Dacia Logan","description":"Citadine économique 5 places",
       "offers":{"price":"250","priceCurrency":"MAD"}}
      </script></head><body>La Logan à 250 MAD / jour.</body></html>`,
  },
  'https://atlasrent.ma/contact': {
    type: 'text/html',
    body: `<html><head><title>Contact</title></head>
      <body>Appelez le +212 522 123 456 ou écrivez à info@atlasrent.ma</body></html>`,
  },
  'https://shop.atlasrent.ma/promo': {
    type: 'text/html',
    body: `<html><head><title>Promo</title>
      <meta property="og:type" content="product" />
      <meta property="og:title" content="Clio Promo Week-end" />
      <meta property="product:price:amount" content="199" />
      <meta property="product:price:currency" content="MAD" />
      <meta property="og:image" content="https://shop.atlasrent.ma/clio.jpg" />
    </head><body>Offre spéciale week-end</body></html>`,
  },
};

const SHOPIFY_SITE = {
  'https://shopstore.ma/products.json?limit=200': {
    type: 'application/json',
    body: JSON.stringify({
      products: [{
        title: 'Tajine artisanal',
        handle: 'tajine-artisanal',
        product_type: 'Cuisine',
        body_html: '<p>Tajine en terre cuite fait main</p>',
        variants: [{ price: '199.00' }],
        images: [{ src: 'https://shopstore.ma/t.jpg' }],
      }],
    }),
  },
  'https://shopstore.ma/': {
    type: 'text/html',
    body: '<html><head><title>Shop Store</title></head><body>Bienvenue</body></html>',
  },
};

let fetchCalls;

function mockFetch(site) {
  fetchCalls = [];
  global.fetch = jest.fn(async (url) => {
    fetchCalls.push(String(url));
    const page = site[String(url)];
    if (!page) {
      return { ok: false, status: 404, headers: { get: () => 'text/html' }, text: async () => '', json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => page.type },
      text: async () => page.body,
      json: async () => JSON.parse(page.body),
    };
  });
}

const realFetch = global.fetch;
const CACHE_DIR = process.env.WEBCACHE_DIR;

beforeEach(() => {
  WebsiteSource.clearCache();
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
});

afterAll(() => {
  global.fetch = realFetch;
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */

describe('WebsiteSource — périmètre et sécurité des URL', () => {
  test('normalise un domaine nu en URL https', () => {
    expect(normalizeStartUrl('atlasrent.ma').href).toBe('https://atlasrent.ma/');
    expect(normalizeStartUrl('http://atlasrent.ma/page').href).toBe('http://atlasrent.ma/page');
  });

  test('rejette une référence vide ou invalide', () => {
    expect(() => normalizeStartUrl('')).toThrow(/requis/);
    expect(() => normalizeStartUrl('pas une url')).toThrow(/invalide/i);
  });

  test('sous-domaines du même domaine autorisés, externes refusés', () => {
    const apex = apexOf('www.atlasrent.ma');
    expect(apex).toBe('atlasrent.ma');
    expect(isAllowedHost('atlasrent.ma', apex)).toBe(true);
    expect(isAllowedHost('shop.atlasrent.ma', apex)).toBe(true);
    expect(isAllowedHost('www.atlasrent.ma', apex)).toBe(true);
    expect(isAllowedHost('facebook.com', apex)).toBe(false);
    expect(isAllowedHost('atlasrent.ma.evil.com', apex)).toBe(false);
  });

  test('anti-SSRF : adresses locales et privées bloquées', () => {
    for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.9', '169.254.169.254', '::1', '0.0.0.0']) {
      expect(isSafeHost(h)).toBe(false);
    }
    expect(isSafeHost('atlasrent.ma')).toBe(true);
    expect(isSafeHost('41.140.10.10')).toBe(true);
  });
});

describe('WebsiteSource — extraction structurée', () => {
  test('JSON-LD : produits extraits (y compris via @graph et ItemList)', () => {
    const nodes = extractJsonLd(SITE['https://atlasrent.ma/voitures'].body);
    const products = productsFromJsonLd(nodes, 'https://atlasrent.ma/voitures');
    expect(products.map((p) => p.name)).toEqual(['Dacia Logan', 'Renault Clio']);
    expect(products[0].price).toBe('250 MAD');
    expect(products[0].category).toBe('Citadines');
    expect(products[0].image).toBe('https://atlasrent.ma/img/logan.jpg');
  });

  test('fil d\'Ariane -> catégories (sans accueil ni page courante)', () => {
    const nodes = extractJsonLd(SITE['https://atlasrent.ma/voitures'].body);
    expect(categoriesFromBreadcrumbs(nodes)).toEqual(['Citadines']);
  });

  test('Open Graph product extrait quand il n\'y a pas de JSON-LD', () => {
    const p = productFromOpenGraph(
      {
        'og:type': 'product',
        'og:title': 'Clio Promo',
        'product:price:amount': '199',
        'product:price:currency': 'MAD',
        'og:image': 'https://x.ma/i.jpg',
      },
      'https://x.ma/p',
      ''
    );
    expect(p.name).toBe('Clio Promo');
    expect(p.price).toBe('199 MAD');
    expect(productFromOpenGraph({ 'og:type': 'website' }, 'https://x.ma', 'T')).toBeNull();
  });

  test('robots.txt : préfixes Disallow du groupe *', () => {
    expect(parseRobots('User-agent: *\nDisallow: /prive\nDisallow: /tmp*\n\nUser-agent: GPTBot\nDisallow: /'))
      .toEqual(['/prive', '/tmp']);
    expect(parseRobots('User-agent: *\nDisallow: /')).toEqual([]); // blocage total ignoré (site du client)
  });

  test('htmlToText retire scripts et balises, décode les entités', () => {
    expect(htmlToText('<p>Prix&nbsp;: <b>250&amp;plus</b></p><script>x()</script>')).toBe('Prix : 250&plus');
  });
});

describe('WebsiteSource — crawl complet (faux site, zéro réseau)', () => {
  test('analyze : produits, catégories, contact, pages et stats', async () => {
    mockFetch(SITE);
    const source = new WebsiteSource({ ref: 'atlasrent.ma', maxPages: 10 });
    const analysis = await source.analyze();

    expect(analysis.source).toBe('website');
    expect(analysis.siteName).toBe('Atlas Rent');
    expect(analysis.headers).toEqual(['type', 'name', 'price', 'category', 'description', 'url', 'image']);
    expect(analysis.mapping.name).toBe('name');
    expect(analysis.mapping.image).toBe('image_url');

    const products = analysis.sample.filter((r) => r.type === 'produit');
    expect(products.map((p) => p.name)).toEqual(
      expect.arrayContaining(['Dacia Logan', 'Renault Clio', 'Clio Promo Week-end'])
    );
    expect(products).toHaveLength(3); // la Logan, présente sur 2 pages, est dédupliquée

    expect(analysis.stats.categories).toContain('Citadines');
    expect(analysis.stats.emails).toEqual(
      expect.arrayContaining(['contact@atlasrent.ma', 'info@atlasrent.ma'])
    );
    expect(analysis.stats.phones).toContain('+212522123456');
    expect(analysis.stats.pagesCrawled).toBe(5); // home, voitures, logan, contact, promo (sous-domaine)
    expect(analysis.rowCount).toBeGreaterThanOrEqual(8);
  });

  test('périmètre respecté : externes, panier et chemins robots jamais téléchargés', async () => {
    mockFetch(SITE);
    await new WebsiteSource({ ref: 'atlasrent.ma', maxPages: 10 }).analyze();

    expect(fetchCalls.some((u) => u.includes('facebook.com'))).toBe(false);
    expect(fetchCalls.some((u) => u.includes('/cart'))).toBe(false);
    expect(fetchCalls.some((u) => u.includes('/prive'))).toBe(false);
    expect(fetchCalls.some((u) => u.startsWith('https://shop.atlasrent.ma'))).toBe(true);
  });

  test('search : pertinence par mots-clés, sans re-crawler (cache)', async () => {
    mockFetch(SITE);
    const source = new WebsiteSource({ ref: 'atlasrent.ma', maxPages: 10 });
    await source.analyze();
    const callsAfterCrawl = fetchCalls.length;

    const rows = await source.search('vous avez une logan disponible ?');
    expect(rows[0].name).toBe('Dacia Logan');
    expect(fetchCalls.length).toBe(callsAfterCrawl); // aucun nouvel appel réseau

    const fallback = await source.search('xyzabsent');
    expect(fallback.length).toBeGreaterThan(0); // repli : premières lignes
    expect(fallback[0].type).toBe('produit');
  });

  test('boutique Shopify : catalogue récupéré via /products.json', async () => {
    mockFetch(SHOPIFY_SITE);
    const source = new WebsiteSource({ ref: 'shopstore.ma', maxPages: 5 });
    const analysis = await source.analyze();

    expect(analysis.stats.platform).toBe('shopify');
    const tajine = analysis.sample.find((r) => r.name === 'Tajine artisanal');
    expect(tajine.price).toBe('199.00');
    expect(tajine.category).toBe('Cuisine');
    expect(tajine.url).toBe('https://shopstore.ma/products/tajine-artisanal');
    expect(tajine.description).toContain('terre cuite');
  });

  test('fetchPreview expose lignes + stats pour le dashboard', async () => {
    mockFetch(SITE);
    const source = new WebsiteSource({ ref: 'atlasrent.ma', maxPages: 10 });
    const preview = await source.fetchPreview(5);
    expect(preview.rows).toHaveLength(5);
    expect(preview.total).toBeGreaterThanOrEqual(8);
    expect(preview.stats.pagesCrawled).toBe(5);
    expect(preview.headers).toContain('name');
  });

  test('write() refusé : un site est en lecture seule', async () => {
    await expect(new WebsiteSource({ ref: 'atlasrent.ma' }).write({})).rejects.toThrow(/lecture seule/);
  });
});
