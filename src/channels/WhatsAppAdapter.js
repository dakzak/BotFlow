const fs = require('fs');
const path = require('path');
const ChannelAdapter = require('./ChannelAdapter');
const sessionStore = require('../services/sessionStore');

const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Adaptateur WhatsApp via Baileys (paquet npm `baileys`, v7 — la lignée
 * maintenue ; l'ancien nom @whiskeysockets/baileys 6.x est gelé et ses
 * connexions sont désormais rejetées par les serveurs WhatsApp).
 * Une connexion WebSocket persistante PAR AGENT ; la session est sauvegardée
 * dans /sessions/{agentId}/ pour survivre aux redémarrages du serveur.
 *
 * Points importants du cycle de vie Baileys :
 *  - la version du protocole WhatsApp est négociée via fetchLatestBaileysVersion()
 *    (une version périmée provoque des échecs de connexion / erreurs 405) ;
 *  - juste après le scan du QR, Baileys ferme la connexion avec le code
 *    `restartRequired` : il FAUT redémarrer le socket immédiatement ;
 *  - `loggedOut` signifie que l'utilisateur a délié l'appareil : la session
 *    sur disque ne vaut plus rien, on la supprime.
 */
class WhatsAppAdapter extends ChannelAdapter {
  constructor() {
    super('whatsapp');
    // agentId -> { sock, status, qr, stopping, attempts }
    this.connections = new Map();
  }

  hasSavedSession(agentId) {
    return fs.existsSync(path.join(sessionStore.sessionDir(agentId), 'creds.json'));
  }

  _conn(agentId) {
    if (!this.connections.has(agentId)) {
      this.connections.set(agentId, {
        sock: null, status: 'disconnected', qr: null, stopping: false, attempts: 0,
      });
    }
    return this.connections.get(agentId);
  }

  _setStatus(agentId, status, qr = null) {
    const conn = this._conn(agentId);
    conn.status = status;
    conn.qr = qr;
    // statut reflété en base pour le dashboard (best effort, sans bloquer)
    try {
      const { getDb } = require('../db/database');
      const dbStatus = status === 'qr_ready' ? 'connecting' : status;
      getDb()
        .agent.update({ where: { id: agentId }, data: { whatsapp_status: dbStatus } })
        .catch(() => { /* agent supprimé ou base indisponible */ });
    } catch { /* base indisponible (tests unitaires) */ }
  }

  getStatus(agentId) {
    return this._conn(agentId).status;
  }

  getAuthArtifact(agentId) {
    return this._conn(agentId).qr;
  }

  _reconnect(agentId, delayMs) {
    const conn = this._conn(agentId);
    if (conn.stopping) return;
    conn.attempts += 1;
    if (conn.attempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(`[whatsapp] agent=${agentId} abandon après ${MAX_RECONNECT_ATTEMPTS} tentatives`);
      return;
    }
    setTimeout(() => {
      this._start(agentId).catch((err) =>
        console.error(`[whatsapp] reconnexion agent=${agentId} échouée:`, err.message)
      );
    }, delayMs);
  }

  /** Démarrage manuel (route /channel/connect, boot serveur) : repart de zéro. */
  async start(agentId) {
    this._conn(agentId).attempts = 0;
    return this._start(agentId);
  }

  async _start(agentId) {
    const conn = this._conn(agentId);
    if (conn.sock) return; // déjà démarré
    conn.stopping = false;
    this._setStatus(agentId, 'connecting');

    // import dynamique : compatible CJS/ESM et évite de charger Baileys dans les tests
    const baileys = await import('baileys');
    const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket;
    const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = baileys;
    const pino = require('pino');

    const dir = sessionStore.sessionDir(agentId);
    fs.mkdirSync(dir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(dir);

    // version du protocole à jour, sinon WhatsApp refuse la connexion
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      version = undefined; // hors-ligne : Baileys utilisera sa version embarquée
    }

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: ['BotFlow', 'Chrome', '1.0.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
    });
    conn.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) this._setStatus(agentId, 'qr_ready', qr);

      if (connection === 'open') {
        conn.attempts = 0;
        this._setStatus(agentId, 'connected');
        console.log(`[whatsapp] agent=${agentId} connecté ✅`);
        // numéro réellement connecté (ex. '212612345678:12@s.whatsapp.net')
        const selfNumber = String(sock.user?.id || '').split(':')[0].split('@')[0];
        if (selfNumber) {
          this._enforceSingleAgentPerNumber(agentId, selfNumber).catch((err) =>
            console.warn(`[whatsapp] vérification numéro unique échouée: ${err.message}`)
          );
        }
      }

      if (connection === 'close') {
        conn.sock = null;
        const err = lastDisconnect?.error;
        const code = err?.output?.statusCode;
        console.warn(
          `[whatsapp] agent=${agentId} connexion fermée (code=${code ?? '?'}) : ${err?.message || 'raison inconnue'}`
        );
        this._setStatus(agentId, 'disconnected');

        if (code === DisconnectReason.loggedOut) {
          // l'utilisateur a délié l'appareil : la session ne vaut plus rien
          console.log(`[whatsapp] agent=${agentId} délié, session supprimée`);
          this.clearSession(agentId);
        } else if (code === DisconnectReason.restartRequired) {
          // normal juste après le scan du QR : redémarrage immédiat attendu
          conn.attempts = 0;
          this._reconnect(agentId, 500);
        } else if (!conn.stopping) {
          // coupure réseau / serveur WhatsApp : reconnexion progressive
          this._reconnect(agentId, 3000 * Math.max(conn.attempts, 1));
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        try {
          if (!msg.message || msg.key.fromMe) continue;
          const remoteJid = msg.key.remoteJid || '';
          // MVP : conversations privées uniquement (ni groupes, ni statuts)
          if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') continue;
          const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            '';
          if (!text) continue;

          await this._emitInbound({
            agentId,
            customerId: remoteJid,
            customerName: msg.pushName || null,
            text,
            media: null,
          });
        } catch (err) {
          console.error(`[whatsapp] agent=${agentId} traitement message échoué:`, err.message);
        }
      }
    });
  }

  /**
   * Un même numéro WhatsApp ne peut servir qu'UN SEUL agent. Si l'utilisateur
   * re-scanne le même téléphone depuis un nouvel agent, l'ancienne liaison
   * reste pourtant valide côté WhatsApp (multi-appareils) : les DEUX agents
   * recevraient chaque message client et répondraient chacun avec son propre
   * catalogue. On déconnecte donc tout autre agent utilisant ce numéro et on
   * oublie sa session.
   */
  async _enforceSingleAgentPerNumber(agentId, number) {
    const { getDb } = require('../db/database');
    const db = getDb();
    await db.agent.update({
      where: { id: agentId },
      data: { whatsapp_number: number },
    }).catch(() => { /* agent supprimé entre-temps */ });

    const duplicates = await db.agent.findMany({
      where: { id: { not: agentId }, whatsapp_number: number },
      select: { id: true },
    });
    for (const { id } of duplicates) {
      console.warn(
        `[whatsapp] numéro ${number} re-scanné par l'agent ${agentId} : ` +
        `déconnexion de l'ancien agent ${id} (1 numéro = 1 agent)`
      );
      await this.stop(id);
      this.clearSession(id);
      await db.agent.update({
        where: { id },
        data: { whatsapp_number: null, whatsapp_status: 'disconnected' },
      }).catch(() => { /* agent supprimé entre-temps */ });
    }
  }

  async stop(agentId) {
    const conn = this._conn(agentId);
    conn.stopping = true;
    if (conn.sock) {
      try { conn.sock.end(undefined); } catch { /* déjà fermé */ }
      conn.sock = null;
    }
    this._setStatus(agentId, 'disconnected');
  }

  clearSession(agentId) {
    fs.rmSync(sessionStore.sessionDir(agentId), { recursive: true, force: true });
  }

  /** '212612345678' ou '0612...' -> JID WhatsApp ; laisse passer les JID déjà formés. */
  _jid(to) {
    const s = String(to);
    if (s.includes('@')) return s;
    return `${s.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  }

  async sendMessage(agentId, to, text) {
    const { sock } = this._conn(agentId);
    if (!sock) throw new Error(`L'agent ${agentId} n'est pas connecté à WhatsApp`);
    await sock.sendMessage(this._jid(to), { text });
  }

  async sendMedia(agentId, to, mediaUrl, caption) {
    const { sock } = this._conn(agentId);
    if (!sock) throw new Error(`L'agent ${agentId} n'est pas connecté à WhatsApp`);
    await sock.sendMessage(this._jid(to), { image: { url: mediaUrl }, caption: caption || '' });
  }
}

module.exports = new WhatsAppAdapter();
