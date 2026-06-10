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
const REPLY_MAX_TOKENS = 400; // réponse courte, adaptée à WhatsApp
const TRANSACTION_TYPES = ['reservation', 'order', 'inquiry'];

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
  if (fenceMatch) {
    jsonStr = fenceMatch[1];
    text = text.replace(fenceMatch[0], '').trim();
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

/** Prompt système : identité de l'agent + analyse métier + contexte données + règles. */
function buildSystemPrompt(agent, contextRows) {
  let analysis = null;
  try {
    analysis = agent.sheet_analysis ? JSON.parse(agent.sheet_analysis) : null;
  } catch { /* analyse absente ou corrompue */ }

  const catalog = compactRows(contextRows);

  return [
    `Tu es « ${agent.name} », l'assistant virtuel de cette entreprise sur sa messagerie.`,
    `Activité de l'entreprise : ${agent.description || 'non précisée'}.`,
    `Type de métier : ${agent.business_type || 'other'}.`,
    analysis && analysis.mapping
      ? `Signification des colonnes du catalogue : ${JSON.stringify(analysis.mapping)}`
      : null,
    catalog
      ? `DONNÉES DU CATALOGUE (lignes au format « colonne | colonne » ; n'utilise QUE ces informations, n'invente rien) :\n${catalog}`
      : "Aucune donnée catalogue disponible pour cette question.",
    '',
    'RÈGLES :',
    '- Réponds dans la langue du client, en 2 à 4 phrases maximum (conversation WhatsApp).',
    '- Sois poli et commercial ; ne propose que des produits / services présents dans les données ci-dessus.',
    "- Quand le client CONFIRME une réservation ou une commande, ajoute à la TOUTE FIN de ta réponse un bloc :",
    '```json',
    '{"action": "reservation" | "order" | "inquiry", "data": { ... détails ... }, "image": "url optionnelle"}',
    '```',
    "- N'ajoute ce bloc QUE si une action métier doit être enregistrée ; sinon, aucun bloc JSON.",
    "- Si une colonne d'image existe pour l'élément discuté, renseigne \"image\" avec son URL.",
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

/** Enregistre l'action métier détectée comme transaction. */
async function recordTransaction(db, agent, customerId, customerName, action) {
  const type = TRANSACTION_TYPES.includes(action.action) ? action.action : 'inquiry';
  const tx = await db.transaction.create({
    data: {
      agent_id: agent.id,
      org_id: agent.org_id,
      customer_id: customerId || null,
      customer_name: customerName || null,
      transaction_type: type,
      data: JSON.stringify(action.data || {}),
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

  const contextRows = await getDataContext(agent, text);
  const systemPrompt = buildSystemPrompt(agent, contextRows);

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
  HISTORY_LIMIT,
  FALLBACK_REPLY,
};
