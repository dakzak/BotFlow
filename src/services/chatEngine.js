const { getDb } = require('../db/database');
const aiRegistry = require('../ai/AIRegistry');
const dataSourceRegistry = require('../datasources/DataSourceRegistry');

/**
 * Moteur de conversation — cœur applicatif (cahier des charges §4.4).
 * Ne dépend QUE des contrats (registres) : il ignore le canal d'origine
 * et la nature de la source de données.
 */

// Économie de tokens : les organisations utilisent les offres GRATUITES de
// Groq/Gemini (quotas en tokens/minute serrés). Chaque valeur ci-dessous est
// calibrée pour rester sous ces quotas tout en gardant des réponses utiles.
const HISTORY_LIMIT = 10; // messages d'historique envoyés à l'IA
const HISTORY_MSG_MAX_CHARS = 300; // troncature de chaque message d'historique
const CONTEXT_ROWS_LIMIT = 8; // lignes de catalogue injectées dans le prompt
const BOOKINGS_LIMIT = 12; // réservations à venir injectées dans le prompt
const REPLY_MAX_TOKENS = 400; // réponse courte, adaptée à WhatsApp
const TRANSACTION_TYPES = ['reservation', 'order', 'inquiry'];
// Anti-doublon : le modèle répète parfois le bloc JSON à chaque message.
// Une transaction « pending » du même type, même client, plus récente que
// cette fenêtre est MISE À JOUR (fusion des données) au lieu d'être dupliquée.
const TX_DEDUP_WINDOW_MS = 10 * 60 * 1000;

const FALLBACK_REPLY =
  'Désolé, je reçois beaucoup de messages en ce moment 🙏 Merci de réessayer dans une petite minute.';

/**
 * Extrait de la réponse brute de l'IA :
 *  - le texte en langage naturel à envoyer au client ;
 *  - le bloc structuré optionnel { action, data, image } (transaction / média).
 * Le bloc peut être dans une clôture ```json ... ``` ou en JSON brut en fin
 * de réponse. Un bloc malformé est ignoré sans faire échouer la réponse.
 */
function parseAIResponse(raw) {
  if (!raw || typeof raw !== 'string') {
    return { text: '', action: null, mediaUrl: null };
  }

  let text = raw.trim();
  let jsonStr = null;

  const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  const openFence = fenceMatch ? null : text.match(/```(?:json)?\s*(\{[\s\S]*)$/i);
  if (fenceMatch) {
    jsonStr = fenceMatch[1];
    text = text.replace(fenceMatch[0], '').trim();
  } else if (openFence) {
    // clôture ``` ouverte mais jamais fermée (sortie tronquée) : ce fragment
    // ne doit JAMAIS partir au client — on le retire du texte dans tous les
    // cas, et on tente quand même d'en extraire l'action.
    const candidate = openFence[1].replace(/`+\s*$/, '').trim();
    try {
      JSON.parse(candidate);
      jsonStr = candidate;
    } catch { /* fragment incomplet : ignoré */ }
    text = text.slice(0, openFence.index).trim();
  } else {
    // JSON brut en fin de réponse : on cherche la première accolade ouvrante
    // telle que tout le reste de la chaîne soit un objet JSON valide.
    for (let i = text.indexOf('{'); i !== -1; i = text.indexOf('{', i + 1)) {
      const candidate = text.slice(i);
      if (!/"action"\s*:/.test(candidate)) continue;
      try {
        JSON.parse(candidate);
        jsonStr = candidate;
        text = text.slice(0, i).trim();
        break;
      } catch {
        // pas un JSON complet à partir d'ici, on continue
      }
    }
  }

  let action = null;
  let mediaUrl = null;
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object') {
        if (parsed.action && parsed.action !== 'none') {
          action = { action: parsed.action, data: parsed.data || {} };
        }
        if (parsed.image && /^https?:\/\//i.test(parsed.image)) {
          mediaUrl = parsed.image;
        }
      }
    } catch {
      // bloc malformé : on garde uniquement le texte
    }
  }

  // aucun reste de clôture Markdown (```json, ```) ne doit partir au client
  text = text.replace(/```(?:json)?/gi, '').trim();

  return { text, action, mediaUrl };
}

/**
 * Sérialisation COMPACTE des lignes du catalogue pour le prompt :
 * en-têtes une seule fois puis valeurs séparées par « | » — environ 10x moins
 * de tokens que du JSON (clés répétées à chaque ligne). Les colonnes vides
 * sont omises, les cellules longues tronquées (sauf les URL, nécessaires
 * pour l'envoi d'images).
 */
function compactRows(rows, { maxRows = CONTEXT_ROWS_LIMIT, maxCell = 80, maxChars = 3000 } = {}) {
  if (!rows || !rows.length) return '';
  const slice = rows.slice(0, maxRows);
  const headers = Object.keys(slice[0]).filter((h) =>
    slice.some((r) => String(r[h] ?? '').trim() !== '')
  );
  if (!headers.length) return '';
  const cell = (v) => {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim();
    if (/^https?:\/\//i.test(s)) return s; // garder les URL entières (images)
    return s.length > maxCell ? s.slice(0, maxCell) + '…' : s;
  };
  const lines = [headers.join(' | ')];
  for (const r of slice) lines.push(headers.map((h) => cell(r[h])).join(' | '));
  const out = lines.join('\n');
  return out.length > maxChars ? out.slice(0, maxChars) : out;
}

/** Parse strict d'une date AAAA-MM-JJ (format imposé à l'IA) -> Date UTC ou null. */
function parseISODate(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // rejette les dates impossibles (2026-02-31 « déborde » sur mars)
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return d;
}

const formatDate = (d) => d.toISOString().slice(0, 10);
const todayUTC = () => parseISODate(formatDate(new Date()));

// Le prompt impose "item" / "start_date" / "end_date", mais l'IA dévie parfois ;
// on tolère les noms de champs les plus probables pour ne pas perdre la garde.
const ITEM_KEYS = ['item', 'vehicule', 'véhicule', 'voiture', 'produit', 'service', 'article', 'nom', 'name'];
const START_KEYS = ['start_date', 'date_debut', 'date_début', 'date'];
const END_KEYS = ['end_date', 'date_fin', 'date'];

/** Première valeur non vide parmi les clés candidates (insensible à la casse). */
function pickField(data, keys) {
  if (!data || typeof data !== 'object') return null;
  const lower = {};
  for (const [k, v] of Object.entries(data)) lower[k.toLowerCase()] = v;
  const v = keys.map((k) => lower[k]).find((x) => typeof x === 'string' && x.trim());
  return v ? v.trim() : null;
}

/** Nom de l'élément réservé / commandé dans un data de transaction, ou null. */
function extractItem(data) {
  return pickField(data, ITEM_KEYS);
}

/**
 * Extrait { item, start, end } du champ data d'une transaction (réservation).
 * Une date unique (« date ») vaut pour le début ET la fin (réservation d'un jour).
 * Retourne null si l'élément ou les dates sont absents / invalides.
 */
function extractBooking(data) {
  const item = extractItem(data);
  const start = parseISODate(pickField(data, START_KEYS));
  const end = parseISODate(pickField(data, END_KEYS)) || start;
  if (!item || !start || !end || end < start) return null;
  return { item, start, end };
}

const normalizeItem = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Retire les champs vides ("" / null / undefined) d'un data de transaction. */
function cleanActionData(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    out[k] = v;
  }
  return out;
}

// Mots darija (alphabet latin) suffisamment distinctifs pour identifier la
// langue d'un message ; volontairement sans mots ambigus avec le français.
const DARIJA_LATIN_MARKERS = [
  'wach', 'wash', 'wakha', 'bghit', 'bghina', 'kayn', 'kayna', 'kaynin',
  'chhal', 'ch7al', 'bch7al', '3afak', '3fak', 'labas', 'mzyan', 'meziane',
  'dyal', 'dyali', 'khoya', 'sahbi', 'chno', 'chnou', 'achno', 'nakhdha',
  '3andek', '3andkom', 'daba', 'ghadi', 'ghir', 'walakin', 'tomobil',
  'tonobil', 'smahli', 'inchallah', 'yallah', 'safi', 'zwina', 'zwin',
  'flouss', 'atay', 'nkri', 'kanbghi', 'momkin', 'mumkin', 'salam',
];
const ENGLISH_MARKERS = [
  'the', 'you', 'your', 'want', 'need', 'have', 'how', 'much', 'many',
  'hello', 'price', 'available', 'book', 'booking', 'rent', 'can', 'what',
  'when', 'where', 'thanks', 'please', 'would', 'like', 'there', 'this',
];

/**
 * Détection heuristique de la langue d'un message client. Le résultat est
 * injecté dans le prompt pour que le bot réponde dans la même langue ET
 * change de langue dès que le client en change.
 */
function detectLanguage(text) {
  const t = String(text || '');
  if (/[؀-ۿ]/.test(t)) return 'darija marocaine ou arabe (écriture arabe)';
  const words = t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const hits = (markers) => words.filter((w) => markers.includes(w)).length;
  if (hits(DARIJA_LATIN_MARKERS) >= 1) return 'darija marocaine (alphabet latin)';
  if (hits(ENGLISH_MARKERS) >= 2) return 'anglais';
  return 'français';
}

/**
 * Réservations actives (pending/confirmed, non terminées) de l'agent, avec
 * dates exploitables. Sert à la fois au prompt (l'IA voit ce qui est pris)
 * et au garde-fou serveur anti double-réservation.
 */
async function getActiveBookings(db, agent) {
  const rows = await db.transaction.findMany({
    where: {
      agent_id: agent.id,
      transaction_type: 'reservation',
      status: { in: ['pending', 'confirmed'] },
    },
    orderBy: { created_at: 'desc' },
    take: 200,
  });
  const today = todayUTC();
  const bookings = [];
  for (const r of rows) {
    let booking = null;
    try {
      booking = extractBooking(JSON.parse(r.data || '{}'));
    } catch { /* data corrompue : ignorée */ }
    if (booking && booking.end >= today) {
      bookings.push({ ...booking, customerId: r.customer_id });
    }
  }
  return bookings;
}

/** Sérialisation compacte des réservations pour le prompt (élément | du | au). */
function compactBookings(bookings, limit = BOOKINGS_LIMIT) {
  return bookings
    .slice(0, limit)
    .map((b) => `${b.item} | ${formatDate(b.start)} | ${formatDate(b.end)}`)
    .join('\n');
}

/**
 * Chevauchement entre la demande et les réservations existantes du même élément.
 * Retourne null si la période est libre, sinon { until, nextAvailable } :
 * l'élément redevient disponible le lendemain de la dernière fin en conflit.
 * Les réservations du client demandeur sont ignorées : sa propre réservation
 * répétée n'est pas un conflit (elle est fusionnée par l'anti-doublon).
 */
function findConflict(bookings, request, { excludeCustomerId = null } = {}) {
  const wanted = normalizeItem(request.item);
  let until = null;
  for (const b of bookings) {
    if (excludeCustomerId && b.customerId === excludeCustomerId) continue;
    if (normalizeItem(b.item) !== wanted) continue;
    if (b.start <= request.end && request.start <= b.end) {
      if (!until || b.end > until) until = b.end;
    }
  }
  if (!until) return null;
  return { until, nextAvailable: new Date(until.getTime() + 24 * 60 * 60 * 1000) };
}

/** Prompt système : identité + analyse métier + contexte données + langue + règles. */
function buildSystemPrompt(agent, contextRows, bookings = [], customerLanguage = null) {
  let analysis = null;
  try {
    analysis = agent.sheet_analysis ? JSON.parse(agent.sheet_analysis) : null;
  } catch { /* analyse absente ou corrompue */ }

  const catalog = compactRows(contextRows);
  const booked = compactBookings(bookings);

  return [
    `Tu es « ${agent.name} », l'assistant virtuel de cette entreprise sur sa messagerie.`,
    `Activité de l'entreprise : ${agent.description || 'non précisée'}.`,
    `Type de métier : ${agent.business_type || 'other'}.`,
    `Date du jour : ${formatDate(new Date())}.`,
    analysis && analysis.mapping
      ? `Signification des colonnes du catalogue : ${JSON.stringify(analysis.mapping)}`
      : null,
    catalog
      ? `DONNÉES DU CATALOGUE (lignes au format « colonne | colonne » ; n'utilise QUE ces informations, n'invente rien) :\n${catalog}`
      : "Aucune donnée catalogue disponible pour cette question.",
    booked
      ? `RÉSERVATIONS DÉJÀ ENREGISTRÉES (élément | du | au) — ces éléments sont INDISPONIBLES sur ces périodes :\n${booked}`
      : null,
    '',
    'LANGUES :',
    "- Les clients écrivent en darija marocaine (alphabet arabe OU latin, ex. « wach kayna chi tomobil », « bghit nkri »), en arabe, en français ou en anglais — comprends les quatre.",
    customerLanguage
      ? `- Langue détectée du DERNIER message du client : ${customerLanguage}. Réponds STRICTEMENT dans cette langue, sans mélanger.`
      : '- Réponds TOUJOURS dans la langue du dernier message du client.',
    "- Si le client change de langue en cours de conversation, change IMMÉDIATEMENT avec lui — suis toujours la langue de son dernier message, pas celle du début de la conversation.",
    "- Si le message est ambigu ou incompréhensible, pose UNE question de clarification polie au lieu de deviner.",
    '',
    'RÈGLES :',
    '- Réponds en 2 à 4 phrases maximum (conversation WhatsApp).',
    '- Sois poli et commercial ; ne propose que des produits / services présents dans les données ci-dessus.',
    "- Si l'information demandée n'est pas dans les données, dis-le honnêtement.",
    "- Avant de confirmer une réservation (location, rendez-vous, service), demande TOUJOURS la date de début et la date de fin souhaitées. Pour une commande, demande la date de livraison ou de retrait.",
    "- Vérifie les réservations déjà enregistrées ci-dessus : si l'élément demandé est pris sur des dates qui se chevauchent, ne confirme PAS ; indique au client la première date où il sera disponible (le lendemain de la fin de la réservation existante) et propose-la.",
    '',
    'ENREGISTREMENT DES TRANSACTIONS — règle STRICTE :',
    "- Ajoute un bloc JSON à la TOUTE FIN de ta réponse UNIQUEMENT quand le client vient de CONFIRMER explicitement une réservation ou une commande (ex. « oui je confirme », « wakha nakhdha », « نأكد الحجز », « c'est bon je la prends »).",
    '```json',
    '{"action": "reservation" | "order", "data": { ... détails ... }, "image": "url optionnelle"}',
    '```',
    "- JAMAIS de bloc JSON pour une question, une demande de prix, une hésitation, une salutation ou une simple présentation de produits.",
    '- "reservation" = élément bloqué sur une période (location, rendez-vous, service) ; "order" = achat / commande de produit.',
    '- Le champ "data" doit contenir "item" (le NOM exact dans le catalogue, pas la référence), "start_date" et "end_date" au format AAAA-MM-JJ (même valeur pour un seul jour ; pour une commande, la date de livraison).',
    "- NE confirme JAMAIS une réservation sans connaître start_date ET end_date : tant que les dates manquent, demande-les au client et n'ajoute AUCUN bloc JSON.",
    '- N\'inclus JAMAIS de champs vides dans "data" : un champ inconnu est simplement omis.',
    "- Une même réservation ne s'enregistre qu'UNE SEULE fois : si elle est déjà confirmée plus haut dans l'historique, n'ajoute PLUS de bloc.",
    "- Si une colonne d'image existe pour l'élément réservé, renseigne \"image\" avec son URL.",
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/** Contexte catalogue via la source de données de l'agent (best effort). */
async function getDataContext(agent, query) {
  if (!agent.data_source_type || !agent.source_ref) return [];
  try {
    const source = dataSourceRegistry.create(agent.data_source_type, { ref: agent.source_ref });
    return await source.search(query, { limit: CONTEXT_ROWS_LIMIT });
  } catch (err) {
    console.warn(`[chat] agent=${agent.id} contexte données indisponible : ${err.message}`);
    return [];
  }
}

/** Charge la conversation (agent, canal, client) ou la crée — atomique via upsert. */
async function loadOrCreateConversation(db, agent, channel, customerId, customerName) {
  return db.conversation.upsert({
    where: {
      agent_id_channel_customer_id: {
        agent_id: agent.id,
        channel,
        customer_id: customerId,
      },
    },
    update: {},
    create: {
      agent_id: agent.id,
      org_id: agent.org_id,
      channel,
      customer_id: customerId,
      customer_name: customerName || null,
      messages: '[]',
      last_message_at: new Date(),
    },
  });
}

/**
 * Enregistre l'action métier détectée comme transaction.
 * Anti-doublon : si une transaction « pending » du même type pour le même
 * client existe dans la fenêtre récente, on FUSIONNE les nouvelles données
 * dedans au lieu de créer une nouvelle ligne (le modèle répète parfois le
 * bloc à chaque message de la même conversation). Exception : un AUTRE
 * élément (2e voiture, 2e produit) reste une transaction distincte.
 */
async function recordTransaction(db, agent, customerId, customerName, action) {
  const type = TRANSACTION_TYPES.includes(action.action) ? action.action : 'inquiry';
  // l'IA renvoie parfois "start_date": "" malgré le prompt : on ne stocke
  // jamais de champs vides
  const data = cleanActionData(action.data);

  const recent = await db.transaction.findFirst({
    where: {
      agent_id: agent.id,
      customer_id: customerId || null,
      transaction_type: type,
      status: 'pending',
      created_at: { gte: new Date(Date.now() - TX_DEDUP_WINDOW_MS) },
    },
    orderBy: { created_at: 'desc' },
  });
  if (recent) {
    let existing = {};
    try {
      existing = JSON.parse(recent.data || '{}');
    } catch { /* data corrompue : on repart des nouvelles données */ }
    const itemBefore = extractItem(existing);
    const itemAfter = extractItem(data);
    const sameItem =
      !itemBefore || !itemAfter || normalizeItem(itemBefore) === normalizeItem(itemAfter);
    if (sameItem) {
      const merged = { ...existing, ...data };
      await db.transaction.update({
        where: { id: recent.id },
        data: { data: JSON.stringify(merged) },
      });
      return recent.id;
    }
  }

  const tx = await db.transaction.create({
    data: {
      agent_id: agent.id,
      org_id: agent.org_id,
      customer_id: customerId || null,
      customer_name: customerName || null,
      transaction_type: type,
      data: JSON.stringify(data),
    },
  });
  return tx.id;
}

/**
 * Point d'entrée appelé par les adaptateurs de canal avec un message normalisé.
 * Retourne { text, mediaUrl } à renvoyer au client, ou null si rien à faire.
 */
async function handleInboundMessage({ agentId, channel = 'whatsapp', customerId, customerName, text }) {
  if (!text || !customerId) return null;

  const db = getDb();
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent || agent.status !== 'active') return null;

  const conversation = await loadOrCreateConversation(db, agent, channel, customerId, customerName);
  const fullHistory = JSON.parse(conversation.messages || '[]');
  const history = fullHistory
    .slice(-HISTORY_LIMIT)
    .map(({ role, content }) => ({
      role,
      content: String(content || '').slice(0, HISTORY_MSG_MAX_CHARS),
    }));

  // La recherche catalogue inclut les 2 derniers messages du client : un
  // « wakha nakhdha » seul ne matche rien, mais avec « la Clio à Casablanca »
  // du message précédent le contexte reste pertinent.
  const lastUserMessages = fullHistory
    .filter((m) => m.role === 'user')
    .slice(-2)
    .map((m) => m.content);
  const searchQuery = [...lastUserMessages, text].join(' ');

  const [contextRows, bookings] = await Promise.all([
    getDataContext(agent, searchQuery),
    getActiveBookings(db, agent),
  ]);
  const customerLanguage = detectLanguage(text);
  const systemPrompt = buildSystemPrompt(agent, contextRows, bookings, customerLanguage);

  const provider = aiRegistry.get(agent.ai_provider || 'groq');
  const keys = JSON.parse(agent.ai_tokens || '[]');

  let replyText;
  let action = null;
  let mediaUrl = null;
  try {
    const raw = await provider.complete(
      [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: text }],
      { keys, model: agent.ai_model || undefined, maxTokens: REPLY_MAX_TOKENS }
    );
    ({ text: replyText, action, mediaUrl } = parseAIResponse(raw));
  } catch (err) {
    // quota atteint / IA indisponible : on répond poliment plutôt que de se taire
    console.error(`[chat] agent=${agent.id} IA indisponible : ${err.message}`);
    replyText = FALLBACK_REPLY;
  }

  // Garde-fou serveur : même si l'IA confirme malgré le prompt, une réservation
  // qui chevauche une réservation active du même élément n'est PAS enregistrée.
  if (action && action.action === 'reservation') {
    const requested = extractBooking(action.data);
    const conflict = requested
      ? findConflict(bookings, requested, { excludeCustomerId: customerId })
      : null;
    if (conflict) {
      action = null;
      mediaUrl = null;
      replyText =
        `Désolé, « ${requested.item} » est déjà réservé sur ces dates 🙏 ` +
        `Il sera disponible à partir du ${formatDate(conflict.nextAvailable)}. ` +
        'Souhaitez-vous réserver à partir de cette date ?';
    }
  }

  if (action) {
    await recordTransaction(db, agent, customerId, customerName, action);
  }

  const now = new Date().toISOString();
  const updated = [
    ...fullHistory,
    { role: 'user', content: text, timestamp: now },
    { role: 'assistant', content: replyText, timestamp: now },
  ];
  await db.conversation.update({
    where: { id: conversation.id },
    data: {
      messages: JSON.stringify(updated),
      customer_name: customerName || conversation.customer_name,
      last_message_at: new Date(),
    },
  });

  return { text: replyText, mediaUrl };
}

module.exports = {
  handleInboundMessage,
  parseAIResponse,
  buildSystemPrompt,
  compactRows,
  getDataContext,
  recordTransaction,
  parseISODate,
  extractBooking,
  getActiveBookings,
  compactBookings,
  findConflict,
  detectLanguage,
  cleanActionData,
  HISTORY_LIMIT,
  FALLBACK_REPLY,
};
