const DataSource = require('./DataSource');

/**
 * Parseur CSV minimal (RFC 4180) : guillemets, virgules et sauts de ligne
 * dans les champs. Suffisant pour l'export CSV de Google Sheets.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v !== ''));
}

const COLUMN_HINTS = [
  { meaning: 'name', patterns: [/\bnom\b/i, /\bname\b/i, /titre/i, /title/i, /mod[eè]le|model/i, /produit|product/i, /v[ée]hicule/i, /article/i] },
  { meaning: 'price', patterns: [/prix/i, /price/i, /tarif/i, /montant/i, /\b(dh|mad|eur|usd)\b/i] },
  { meaning: 'city', patterns: [/ville/i, /\bcity\b/i, /lieu/i, /location/i, /agence/i] },
  { meaning: 'category', patterns: [/cat[ée]gorie|category/i, /\btype\b/i, /gamme/i, /marque|brand/i] },
  { meaning: 'availability', patterns: [/dispo/i, /availab/i, /stock/i, /statut|status/i] },
  { meaning: 'image_url', patterns: [/image/i, /photo/i, /\bimg\b/i, /picture/i] },
  { meaning: 'description', patterns: [/desc/i, /d[ée]tail/i, /\binfo\b/i] },
];

/**
 * Détection heuristique du sens d'une colonne à partir de son en-tête
 * et d'un échantillon de valeurs. L'utilisateur confirme / ajuste ensuite
 * le mapping dans le wizard (étape 2).
 */
function guessColumnMeaning(header, samples = []) {
  for (const { meaning, patterns } of COLUMN_HINTS) {
    if (patterns.some((p) => p.test(header))) return meaning;
  }
  if (samples.some((v) => /^https?:\/\/\S+\.(png|jpe?g|webp|gif)(\?\S*)?$/i.test(String(v).trim()))) {
    return 'image_url';
  }
  return 'other';
}

// Cache mémoire par URL CSV : évite de retélécharger TOUTE la feuille à
// chaque message client (latence + quotas Google). TTL court pour que les
// modifications du catalogue restent visibles rapidement.
const tableCache = new Map(); // csvUrl -> { at, table }
const CACHE_TTL_MS = 60_000;

/**
 * Source Google Sheets (MVP) — feuille PUBLIQUE (« toute personne disposant
 * du lien peut consulter »), lue via l'export CSV : aucune clé d'API requise.
 * L'écriture (réservation -> Sheet) nécessitera l'API officielle (Phase 2).
 */
class GoogleSheetsSource extends DataSource {
  constructor(config = {}) {
    super('google_sheets', config);
    this.ref = config.ref;
  }

  spreadsheetId() {
    const m = String(this.ref || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) {
      const err = new Error('URL Google Sheets invalide (attendu : https://docs.google.com/spreadsheets/d/...)');
      err.status = 400;
      throw err;
    }
    return m[1];
  }

  csvUrl() {
    const gid = String(this.ref || '').match(/[#&?]gid=(\d+)/);
    return `https://docs.google.com/spreadsheets/d/${this.spreadsheetId()}/export?format=csv${gid ? `&gid=${gid[1]}` : ''}`;
  }

  /**
   * Lit toute la feuille -> { headers: [...], records: [{col: val}] }.
   * Résultat mis en cache 60 s ; `fresh: true` force la relecture
   * (bouton « Actualiser », analyse du wizard).
   */
  async fetchTable({ fresh = false } = {}) {
    const key = this.csvUrl();
    const hit = tableCache.get(key);
    if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.table;

    const resp = await fetch(key, { redirect: 'follow' });
    if (!resp.ok) {
      const err = new Error(
        `Lecture du Google Sheet impossible (HTTP ${resp.status}). ` +
        'Vérifiez que la feuille est partagée en « Toute personne disposant du lien peut consulter ».'
      );
      err.status = 422;
      throw err;
    }
    const rows = parseCsv(await resp.text());
    let table;
    if (!rows.length) {
      table = { headers: [], records: [] };
    } else {
      const [headers, ...data] = rows;
      const records = data.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
      table = { headers, records };
    }
    tableCache.set(key, { at: Date.now(), table });
    return table;
  }

  /** Étape 2 du wizard : 5 premières lignes + mapping détecté. */
  async analyze() {
    const { headers, records } = await this.fetchTable({ fresh: true });
    const sample = records.slice(0, 5);
    const mapping = {};
    for (const h of headers) {
      mapping[h] = guessColumnMeaning(h, sample.map((r) => r[h]));
    }
    return { source: 'google_sheets', headers, sample, mapping, rowCount: records.length };
  }

  async fetchPreview(limit = 20) {
    const { headers, records } = await this.fetchTable({ fresh: true });
    return { headers, rows: records.slice(0, limit), total: records.length };
  }

  /**
   * Contexte pour le moteur : filtre naïf par mots-clés, insensible à la casse
   * ET aux accents (« reservation » matche « Réservation », « velo » → « vélo »),
   * avec repli sur les premières lignes si rien ne matche (l'IA fait le tri final).
   * Phase 2 : remplacé par une vraie recherche RAG pour les gros volumes.
   */
  async search(query, { limit = 12 } = {}) {
    const { records } = await this.fetchTable();
    // petit catalogue : tout envoyer, le bot voit l'offre COMPLÈTE quelle que
    // soit la formulation de la question (essentiel pour « quelles voitures
    // avez-vous ? » qui ne matche aucun mot-clé des lignes)
    if (records.length <= limit) return records;
    const fold = (s) =>
      String(s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
    const terms = fold(query || '')
      .split(/\s+/)
      .filter((t) => t.length > 2);
    if (!terms.length) return records.slice(0, limit);

    const scored = records
      .map((r) => {
        const haystack = fold(Object.values(r).join(' '));
        return { r, score: terms.filter((t) => haystack.includes(t)).length };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.r);

    return (scored.length ? scored : records).slice(0, limit);
  }

  async write() {
    throw new Error(
      "Écriture impossible sur une feuille publique en lecture seule. " +
      'Phase 2 : API Google Sheets officielle avec compte de service.'
    );
  }
}

module.exports = GoogleSheetsSource;
module.exports.parseCsv = parseCsv;
module.exports.guessColumnMeaning = guessColumnMeaning;
