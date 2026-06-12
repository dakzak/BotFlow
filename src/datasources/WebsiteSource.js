const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DataSource = require('./DataSource');

/**
 * Source « Site web » — l'organisation donne son domaine, BotFlow explore le
 * site (pages internes + sous-domaines du même domaine) et en extrait un
 * catalogue exploitable par l'IA : produits, catégories, coordonnées, pages
 * d'information.
 *
 * Stratégie d'extraction (sans dépendance externe) :
 *  1. sondes plateformes : /products.json (Shopify) et l'API Store de
 *     WooCommerce — catalogues JSON publics, le cas le plus fiable ;
 *  2. JSON-LD schema.org (Product, ItemList, BreadcrumbList) — présent sur la
 *     plupart des boutiques modernes ;
 *  3. balises Open Graph (og:type=product, product:price:amount...) ;
 *  4. texte des pages (titre + meta description) pour les infos générales.
 *
 * Le crawl est borné (pages, profondeur, durée) et le résultat est mis en
 * cache mémoire + disque : les messages WhatsApp suivants répondent sans
 * re-crawler le site.
 */

const MAX_PAGES = 40; // pages HTML réellement téléchargées
const MAX_DEPTH = 3;
const MAX_PRODUCTS = 200;
const MAX_INFO_PAGES = 10;
const FETCH_TIMEOUT_MS = 10_000;
const CRAWL_BUDGET_MS = 25_000; // durée totale max d'un crawl
const MAX_HTML_BYTES = 1_500_000;
const CONCURRENCY = 4;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 h — relancer « Analyser » pour forcer
const USER_AGENT = 'Mozilla/5.0 (compatible; BotFlowBot/1.0; +https://botflow.app)';

/** Colonnes UNIFORMES des lignes produites (contrat avec compactRows / le prompt). */
const ROW_HEADERS = ['type', 'name', 'price', 'category', 'description', 'url', 'image'];
const ROW_MAPPING = {
  type: 'other',
  name: 'name',
  price: 'price',
  category: 'category',
  description: 'description',
  url: 'other',
  image: 'image_url',
};

/* ------------------------------------------------------------------ */
/* URL : normalisation, périmètre du domaine, anti-SSRF                */
/* ------------------------------------------------------------------ */

/** « atlasrent.ma » ou « https://atlasrent.ma/x » -> URL de départ valide. */
function normalizeStartUrl(ref) {
  const raw = String(ref || '').trim();
  if (!raw) {
    const err = new Error('Domaine du site requis (ex. : monsite.ma)');
    err.status = 400;
    throw err;
  }
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    const err = new Error(`Adresse de site invalide : ${raw}`);
    err.status = 400;
    throw err;
  }
  if (!isSafeHost(url.hostname)) {
    const err = new Error('Ce domaine ne peut pas être exploré.');
    err.status = 400;
    throw err;
  }
  return url;
}

/** Domaine « racine » du périmètre : www.monsite.ma -> monsite.ma. */
function apexOf(hostname) {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/** Même domaine OU sous-domaine (shop.monsite.ma, www.monsite.ma...). */
function isAllowedHost(hostname, apex) {
  const h = hostname.toLowerCase();
  return h === apex || h.endsWith(`.${apex}`);
}

/** Garde anti-SSRF : jamais d'adresses locales / privées / non HTTP. */
function isSafeHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return false;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 0 || a === 10 || a === 127 || a === 169 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return false;
    }
  }
  return true;
}

/** Canonicalise pour dédupliquer : sans ancre, sans paramètres de tracking. */
function canonicalUrl(url) {
  const u = new URL(url.href);
  u.hash = '';
  for (const p of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_eid|ref$)/i.test(p)) u.searchParams.delete(p);
  }
  return u.href.replace(/\/$/, '');
}

const BINARY_EXT = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|xml|pdf|zip|rar|7z|mp[34]|avi|mov|woff2?|ttf|eot|docx?|xlsx?|pptx?)(\?|$)/i;
const SKIP_PATH = /(wp-admin|wp-login|\/cart|\/panier|\/checkout|\/commande|\/login|\/connexion|\/account|\/compte|\/admin|mentions-legales|privacy|politique|cookies|cgv|cgu|terms)/i;
const HOT_PATH = /(produit|product|article|item|voiture|vehicule|véhicule|car|moto|velo|vélo|menu|service|offre|tarif|prix|pricing|catalog|shop|boutique|store|magasin|collection|categor|gamme|rayon|location|rental|reserv)/i;
const CATEGORY_PATH = /(collections?|categor(y|ies?)|product-category|produit-categorie|gamme|rayon)/i;

/** Priorité d'exploration : les pages « catalogue » d'abord, le blog après. */
function urlScore(url) {
  const p = url.pathname.toLowerCase();
  let score = 0;
  if (HOT_PATH.test(p)) score += 20;
  if (CATEGORY_PATH.test(p)) score += 10;
  const segments = p.split('/').filter(Boolean).length;
  if (segments <= 1) score += 8;
  if (segments >= 4) score -= 8;
  if (/(blog|actualite|news|press|faq)/i.test(p)) score -= 12;
  return score;
}

/* ------------------------------------------------------------------ */
/* HTML : extraction sans dépendance (regex ciblées)                   */
/* ------------------------------------------------------------------ */

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** HTML -> texte brut (scripts/styles retirés, espaces normalisés). */
function htmlToText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? htmlToText(m[1]).slice(0, 150) : '';
}

/** Toutes les balises <meta> -> { 'og:title': ..., description: ..., ... }. */
function extractMetaTags(html) {
  const out = {};
  for (const tag of String(html || '').match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? '');
    }
    const key = attrs.property || attrs.name;
    if (key && attrs.content && out[key.toLowerCase()] === undefined) {
      out[key.toLowerCase()] = attrs.content;
    }
  }
  return out;
}

/** Blocs <script type="application/ld+json"> -> objets (tableaux et @graph aplatis). */
function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of String(html || '').matchAll(re)) {
    try {
      flattenLd(JSON.parse(m[1].trim()), out);
    } catch { /* bloc malformé : ignoré */ }
  }
  return out;
}

function flattenLd(node, out) {
  if (Array.isArray(node)) {
    for (const n of node) flattenLd(n, out);
  } else if (node && typeof node === 'object') {
    out.push(node);
    if (node['@graph']) flattenLd(node['@graph'], out);
    if (node.itemListElement) {
      for (const el of [].concat(node.itemListElement)) {
        if (el && typeof el === 'object') flattenLd(el.item || el, out);
      }
    }
  }
}

/** Liens internes + contacts d'une page. */
function extractLinks(html, baseUrl) {
  const internal = [];
  const emails = new Set();
  const phones = new Set();
  for (const m of String(html || '').matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const href = decodeEntities(m[1] ?? m[2] ?? '').trim();
    if (!href) continue;
    if (/^mailto:/i.test(href)) {
      const e = href.slice(7).split('?')[0].trim().toLowerCase();
      if (e) emails.add(e);
      continue;
    }
    if (/^tel:/i.test(href)) {
      const t = href.slice(4).replace(/[^\d+]/g, '');
      if (t.length >= 8) phones.add(t);
      continue;
    }
    if (/^(javascript|data|#)/i.test(href)) continue;
    try {
      internal.push(new URL(href, baseUrl));
    } catch { /* href invalide */ }
  }
  return { internal, emails, phones };
}

const ldType = (node) => [].concat(node['@type'] || []).map(String);

function firstImage(image) {
  const img = Array.isArray(image) ? image[0] : image;
  if (!img) return '';
  if (typeof img === 'string') return img;
  return img.url || img.contentUrl || '';
}

function priceLabel(price, currency) {
  if (price === undefined || price === null || price === '') return '';
  return `${price}${currency ? ` ${currency}` : ''}`;
}

/** Produits schema.org d'une page (JSON-LD déjà aplati). */
function productsFromJsonLd(nodes, pageUrl) {
  const products = [];
  for (const node of nodes) {
    if (!ldType(node).some((t) => /Product$/i.test(t))) continue;
    const offer = [].concat(node.offers || [])[0] || {};
    const price = offer.price ?? offer.lowPrice ?? node.price;
    const availability = String(offer.availability || '').split('/').pop();
    products.push({
      type: 'produit',
      name: htmlToText(node.name || '').slice(0, 120),
      price: priceLabel(price, offer.priceCurrency || node.priceCurrency),
      category: htmlToText(
        typeof node.category === 'object' ? (node.category && node.category.name) || '' : [].concat(node.category || [])[0] || ''
      ).slice(0, 60),
      description:
        htmlToText(node.description || '').slice(0, 200) +
        (availability && availability !== 'InStock' ? ` [${availability}]` : ''),
      url: node.url ? String(node.url) : pageUrl,
      image: firstImage(node.image),
    });
  }
  return products.filter((p) => p.name);
}

/** Fil d'Ariane schema.org -> noms de catégories (sans accueil ni page courante). */
function categoriesFromBreadcrumbs(nodes) {
  const cats = [];
  for (const node of nodes) {
    if (!ldType(node).includes('BreadcrumbList')) continue;
    const items = [].concat(node.itemListElement || []);
    for (const it of items.slice(1, -1)) {
      const name = htmlToText((it && (it.name || (it.item && it.item.name))) || '');
      if (name) cats.push(name);
    }
  }
  return cats;
}

/** Produit « Open Graph » (og:type=product) si la page en décrit un. */
function productFromOpenGraph(meta, pageUrl, fallbackTitle) {
  if (!/^product/i.test(meta['og:type'] || '')) return null;
  const name = (meta['og:title'] || fallbackTitle || '').slice(0, 120);
  if (!name) return null;
  return {
    type: 'produit',
    name,
    price: priceLabel(
      meta['product:price:amount'] || meta['og:price:amount'],
      meta['product:price:currency'] || meta['og:price:currency']
    ),
    category: (meta['product:category'] || '').slice(0, 60),
    description: (meta['og:description'] || meta.description || '').slice(0, 200),
    url: meta['og:url'] || pageUrl,
    image: meta['og:image'] || '',
  };
}

/** Texte d'une page -> emails / téléphones (complément des liens mailto/tel). */
function contactsFromText(text) {
  const emails = new Set();
  const phones = new Set();
  for (const m of String(text).matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,12}/gi)) {
    if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(m[0])) emails.add(m[0].toLowerCase());
  }
  for (const m of String(text).matchAll(/\+\d{1,3}[\s.-]?\d(?:[\s.-]?\d){6,11}/g)) {
    phones.add(m[0].replace(/[^\d+]/g, ''));
  }
  return { emails, phones };
}

/* ------------------------------------------------------------------ */
/* robots.txt (politesse minimale)                                     */
/* ------------------------------------------------------------------ */

/** Préfixes « Disallow » du groupe User-agent: * (la page d'accueil reste toujours lue). */
function parseRobots(txt) {
  const rules = [];
  let applies = false;
  for (const line of String(txt || '').split(/\r?\n/)) {
    const l = line.replace(/#.*$/, '').trim();
    const ua = l.match(/^user-agent\s*:\s*(.+)$/i);
    if (ua) {
      applies = ua[1].trim() === '*';
      continue;
    }
    if (!applies) continue;
    const dis = l.match(/^disallow\s*:\s*(\S+)$/i);
    if (dis) rules.push(dis[1].split('*')[0]);
  }
  return rules.filter((r) => r && r !== '/');
}

/* ------------------------------------------------------------------ */
/* Sondes plateformes : catalogues JSON publics                        */
/* ------------------------------------------------------------------ */

/** Shopify : /products.json est public par défaut. */
function productsFromShopify(json, origin) {
  return (json.products || []).map((p) => ({
    type: 'produit',
    name: String(p.title || '').slice(0, 120),
    price: priceLabel(p.variants && p.variants[0] && p.variants[0].price, ''),
    category: String(p.product_type || '').slice(0, 60),
    description: htmlToText(p.body_html || '').slice(0, 200),
    url: `${origin}/products/${p.handle}`,
    image: (p.images && p.images[0] && p.images[0].src) || '',
  })).filter((p) => p.name);
}

/** WooCommerce Store API : prix en centimes (currency_minor_unit). */
function productsFromWoo(json) {
  return (Array.isArray(json) ? json : []).map((p) => {
    const pr = p.prices || {};
    const minor = Number(pr.currency_minor_unit || 0);
    const price = pr.price ? Number(pr.price) / 10 ** minor : '';
    return {
      type: 'produit',
      name: htmlToText(p.name || '').slice(0, 120),
      price: priceLabel(price, pr.currency_code),
      category: htmlToText((p.categories && p.categories[0] && p.categories[0].name) || '').slice(0, 60),
      description: htmlToText(p.short_description || p.description || '').slice(0, 200),
      url: p.permalink || '',
      image: (p.images && p.images[0] && p.images[0].src) || '',
    };
  }).filter((p) => p.name);
}

/* ------------------------------------------------------------------ */
/* Cache crawl : mémoire + disque (les réponses WhatsApp restent vives) */
/* ------------------------------------------------------------------ */

const memoryCache = new Map(); // origin -> { at, data }

function diskCachePath(cacheDir, origin) {
  return path.join(cacheDir, `${crypto.createHash('sha1').update(origin).digest('hex')}.json`);
}

/* ------------------------------------------------------------------ */
/* La source                                                           */
/* ------------------------------------------------------------------ */

class WebsiteSource extends DataSource {
  constructor(config = {}) {
    super('website', config);
    this.ref = config.ref;
    this.maxPages = config.maxPages || MAX_PAGES;
    this.maxDepth = config.maxDepth ?? MAX_DEPTH;
    this.timeoutMs = config.timeoutMs || FETCH_TIMEOUT_MS;
    this.budgetMs = config.budgetMs || CRAWL_BUDGET_MS;
    this.cacheTtlMs = config.cacheTtlMs ?? CACHE_TTL_MS;
    this.cacheDir =
      config.cacheDir || process.env.WEBCACHE_DIR || path.join(process.cwd(), 'data', 'webcache');
  }

  /** Télécharge une URL avec timeout ; retourne null si non exploitable. */
  async fetchUrl(url, { accept = 'text/html', asJson = false } = {}) {
    try {
      const resp = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { 'User-Agent': USER_AGENT, Accept: `${accept},*/*;q=0.5` },
      });
      if (!resp.ok) return null;
      if (asJson) {
        if (!/json/i.test(resp.headers.get('content-type') || '')) return null;
        return await resp.json();
      }
      const body = await resp.text();
      return body.length > MAX_HTML_BYTES ? body.slice(0, MAX_HTML_BYTES) : body;
    } catch {
      return null; // timeout, DNS, TLS... : la page est simplement ignorée
    }
  }

  /** Données du site (cache mémoire -> disque -> crawl complet). */
  async getSiteData({ fresh = false } = {}) {
    const origin = canonicalUrl(normalizeStartUrl(this.ref));

    if (!fresh) {
      const hit = memoryCache.get(origin);
      if (hit && Date.now() - hit.at < this.cacheTtlMs) return hit.data;
      try {
        const raw = JSON.parse(await fs.promises.readFile(diskCachePath(this.cacheDir, origin), 'utf8'));
        if (Date.now() - raw.at < this.cacheTtlMs) {
          memoryCache.set(origin, raw);
          return raw.data;
        }
      } catch { /* pas de cache disque */ }
    }

    const data = await this.crawl();
    const entry = { at: Date.now(), data };
    memoryCache.set(origin, entry);
    try {
      await fs.promises.mkdir(this.cacheDir, { recursive: true });
      await fs.promises.writeFile(diskCachePath(this.cacheDir, origin), JSON.stringify(entry));
    } catch (err) {
      console.warn(`[website] cache disque indisponible : ${err.message}`);
    }
    return data;
  }

  /**
   * Exploration du site : BFS priorisé (pages catalogue d'abord), borné en
   * pages / profondeur / durée. Retourne { rows, stats, siteName }.
   */
  async crawl() {
    const startedAt = Date.now();
    const start = normalizeStartUrl(this.ref);
    const apex = apexOf(start.hostname);
    const startCanonical = canonicalUrl(start);

    const okToVisit = (u) =>
      /^https?:$/.test(u.protocol) &&
      isAllowedHost(u.hostname, apex) &&
      isSafeHost(u.hostname) &&
      !BINARY_EXT.test(u.pathname) &&
      !SKIP_PATH.test(u.pathname);

    // robots.txt (best effort) — la page de départ reste toujours autorisée
    const robotsRules = parseRobots(await this.fetchUrl(`${start.origin}/robots.txt`, { accept: 'text/plain' }));
    const disallowed = (u) =>
      canonicalUrl(u) !== startCanonical && robotsRules.some((r) => u.pathname.startsWith(r));

    const frontier = [{ url: start, depth: 0, score: 100 }];
    const seen = new Set([startCanonical]);
    const enqueue = (u, depth) => {
      if (depth > this.maxDepth || !okToVisit(u) || disallowed(u)) return;
      const key = canonicalUrl(u);
      if (seen.has(key)) return;
      seen.add(key);
      frontier.push({ url: u, depth, score: urlScore(u) });
    };

    // sitemap.xml : la carte officielle du site (sous-domaines compris)
    for (const loc of await this.sitemapLocs(start.origin)) {
      try {
        enqueue(new URL(loc), 1);
      } catch { /* loc invalide */ }
    }

    // catalogues JSON publics (Shopify / WooCommerce)
    let platform = '';
    let products = [];
    const shopify = await this.fetchUrl(`${start.origin}/products.json?limit=${MAX_PRODUCTS}`, { asJson: true });
    if (shopify && Array.isArray(shopify.products) && shopify.products.length) {
      platform = 'shopify';
      products = productsFromShopify(shopify, start.origin);
    } else {
      const woo = await this.fetchUrl(`${start.origin}/wp-json/wc/store/v1/products?per_page=100`, { asJson: true });
      if (Array.isArray(woo) && woo.length) {
        platform = 'woocommerce';
        products = productsFromWoo(woo);
      }
    }

    const pages = [];
    const categories = new Map(); // nom normalisé -> { name, url }
    const emails = new Set();
    const phones = new Set();
    let siteName = '';
    let pagesFetched = 0;

    const addCategory = (name, url = '') => {
      const clean = htmlToText(name).slice(0, 60);
      const key = clean.toLowerCase();
      if (clean.length < 2 || /^(voir|tout|all|home|accueil|menu)$/i.test(clean)) return;
      if (!categories.has(key)) categories.set(key, { name: clean, url });
    };

    while (frontier.length && pagesFetched < this.maxPages && Date.now() - startedAt < this.budgetMs) {
      frontier.sort((a, b) => b.score - a.score);
      const batch = frontier.splice(0, Math.min(CONCURRENCY, this.maxPages - pagesFetched));
      pagesFetched += batch.length;

      const results = await Promise.all(
        batch.map(async (job) => ({ job, html: await this.fetchUrl(job.url.href) }))
      );

      for (const { job, html } of results) {
        if (!html || typeof html !== 'string' || !/<[a-z!]/i.test(html)) continue;

        const meta = extractMetaTags(html);
        const title = extractTitle(html);
        const text = htmlToText(html);
        const ld = extractJsonLd(html);
        const pageUrl = canonicalUrl(job.url);

        if (!siteName) siteName = meta['og:site_name'] || '';
        pages.push({
          url: pageUrl,
          title: title || pageUrl,
          description: (meta.description || meta['og:description'] || text.slice(0, 200)).slice(0, 200),
          score: job.score,
        });

        const found = productsFromJsonLd(ld, pageUrl);
        const og = productFromOpenGraph(meta, pageUrl, title);
        if (og && !found.length) found.push(og);
        products.push(...found);

        for (const c of categoriesFromBreadcrumbs(ld)) addCategory(c);
        for (const p of found) if (p.category) addCategory(p.category);

        const { internal, emails: le, phones: lp } = extractLinks(html, job.url.href);
        le.forEach((e) => emails.add(e));
        lp.forEach((p) => phones.add(p));
        const fromText = contactsFromText(text.slice(0, 20_000));
        fromText.emails.forEach((e) => emails.add(e));
        fromText.phones.forEach((p) => phones.add(p));

        for (const link of internal) {
          if (CATEGORY_PATH.test(link.pathname) && isAllowedHost(link.hostname, apex)) {
            const segment = decodeURIComponent(link.pathname.split('/').filter(Boolean).pop() || '');
            addCategory(segment.replace(/[-_]+/g, ' '), link.href);
          }
          enqueue(link, job.depth + 1);
        }
      }
    }

    // Déduplication des produits (nom + prix) et plafond
    const dedup = new Map();
    for (const p of products) {
      const key = `${p.name.toLowerCase()}|${p.price}`;
      if (!dedup.has(key)) dedup.set(key, p);
    }
    products = [...dedup.values()].slice(0, MAX_PRODUCTS);

    const rows = [
      ...products,
      ...[...categories.values()].map((c) => ({
        type: 'categorie', name: c.name, price: '', category: '', description: '', url: c.url, image: '',
      })),
    ];
    if (emails.size || phones.size) {
      rows.push({
        type: 'contact',
        name: 'Coordonnées',
        price: '',
        category: '',
        description: [
          phones.size ? `Tél : ${[...phones].slice(0, 3).join(', ')}` : '',
          emails.size ? `Email : ${[...emails].slice(0, 3).join(', ')}` : '',
        ].filter(Boolean).join(' · '),
        url: '',
        image: '',
      });
    }
    for (const page of pages.sort((a, b) => b.score - a.score).slice(0, MAX_INFO_PAGES)) {
      rows.push({
        type: 'page', name: page.title, price: '', category: '',
        description: page.description, url: page.url, image: '',
      });
    }

    return {
      rows,
      siteName: siteName || apex,
      stats: {
        startUrl: start.href,
        platform,
        pagesCrawled: pages.length,
        productsFound: products.length,
        categories: [...categories.values()].map((c) => c.name).slice(0, 30),
        emails: [...emails].slice(0, 3),
        phones: [...phones].slice(0, 3),
        durationMs: Date.now() - startedAt,
        crawledAt: new Date().toISOString(),
      },
    };
  }

  /** URLs du sitemap (gère un index de sitemaps sur un niveau). */
  async sitemapLocs(origin) {
    const xml = await this.fetchUrl(`${origin}/sitemap.xml`, { accept: 'application/xml' });
    if (!xml) return [];
    const locs = [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));
    if (!locs.length) return [];
    if (!locs[0].endsWith('.xml')) return locs.slice(0, 150);

    const out = [];
    for (const child of locs.slice(0, 3)) {
      const childXml = await this.fetchUrl(child, { accept: 'application/xml' });
      for (const m of String(childXml || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        out.push(decodeEntities(m[1]));
        if (out.length >= 150) return out;
      }
    }
    return out;
  }

  /** Étape « Analyser » du wizard : crawl FRAIS + rapport pour le dashboard. */
  async analyze() {
    const { rows, stats, siteName } = await this.getSiteData({ fresh: true });
    return {
      source: 'website',
      siteName,
      headers: ROW_HEADERS,
      sample: rows.slice(0, 8),
      mapping: { ...ROW_MAPPING },
      rowCount: rows.length,
      stats,
    };
  }

  async fetchPreview(limit = 20) {
    const { rows, stats, siteName } = await this.getSiteData();
    return { headers: ROW_HEADERS, rows: rows.slice(0, limit), total: rows.length, stats, siteName };
  }

  /**
   * Contexte pour le moteur de conversation : mots-clés insensibles à la casse
   * et aux accents, produits prioritaires à score égal (l'ordre des lignes
   * place déjà produits > catégories > contact > pages).
   */
  async search(query, { limit = 8 } = {}) {
    const { rows } = await this.getSiteData();
    const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const terms = fold(query || '').split(/\s+/).filter((t) => t.length > 2);
    if (!terms.length) return rows.slice(0, limit);

    const scored = rows
      .map((r, i) => {
        const haystack = fold(Object.values(r).join(' '));
        return { r, i, score: terms.filter((t) => haystack.includes(t)).length };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.r);

    return (scored.length ? scored : rows).slice(0, limit);
  }

  async write() {
    throw new Error("Écriture impossible sur un site web (lecture seule).");
  }
}

/** Vide les caches (tests / analyse forcée globale). */
WebsiteSource.clearCache = () => memoryCache.clear();

module.exports = WebsiteSource;
module.exports.normalizeStartUrl = normalizeStartUrl;
module.exports.isAllowedHost = isAllowedHost;
module.exports.isSafeHost = isSafeHost;
module.exports.apexOf = apexOf;
module.exports.extractJsonLd = extractJsonLd;
module.exports.extractMetaTags = extractMetaTags;
module.exports.productsFromJsonLd = productsFromJsonLd;
module.exports.productFromOpenGraph = productFromOpenGraph;
module.exports.categoriesFromBreadcrumbs = categoriesFromBreadcrumbs;
module.exports.htmlToText = htmlToText;
module.exports.parseRobots = parseRobots;
module.exports.urlScore = urlScore;
