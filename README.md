# 🤖 BotFlow — Plateforme SaaS de chatbots IA multi-canal

Création et déploiement de chatbots IA pour entreprises — **sans code**.
WhatsApp (MVP) · Instagram · Messenger · TikTok · Voix (phases suivantes).
Multi-organisation · Multi-sources de données · IA configurable par agent.

> Référence : cahier des charges v1.0 (10 juin 2026).

## Démarrage rapide (local)

```bash
npm install                # installe les dépendances + génère le client Prisma
copy .env.example .env     # (Windows) — ou: cp .env.example .env
npx prisma migrate dev     # crée la base SQLite et applique les migrations
npm run dev                # serveur avec rechargement auto
# ouvrir http://localhost:3000
```

Scripts utiles :

| Commande | Rôle |
|---|---|
| `npm start` | démarrage production (utilisé par Railway) |
| `npm test` | tests unitaires + intégration + contrat (aucun accès réseau) |
| `npm run db:migrate` | créer/appliquer une migration après modification de `prisma/schema.prisma` |
| `npm run db:studio` | explorer la base dans le navigateur (Prisma Studio) |

## Architecture

Une instance applicative unique sert toutes les organisations.
**Hiérarchie : Organisation (1) → Agents (N) → Canaux & Sources → Conversations & Transactions.**

Tout ce qui est « variable » est un **module enfichable derrière une interface** ;
le moteur de conversation ([src/services/chatEngine.js](src/services/chatEngine.js))
ne dépend que des contrats, jamais des implémentations :

| Interface | Contrat | Implémentations MVP | Phases suivantes |
|---|---|---|---|
| `ChannelAdapter` | [src/channels/ChannelAdapter.js](src/channels/ChannelAdapter.js) | WhatsApp (Baileys) | Instagram, Messenger, Voix |
| `DataSource` | [src/datasources/DataSource.js](src/datasources/DataSource.js) | Google Sheets (public, CSV) | Excel, PDF, Site web (RAG) |
| `AIProvider` | [src/ai/AIProvider.js](src/ai/AIProvider.js) | Groq, Gemini (multi-clés + repli) | — |

### Arborescence

```
server.js                  # point d'entrée : boot + câblage canaux -> moteur
prisma/
  schema.prisma            # modèle de données (ORM Prisma + SQLite)
  migrations/              # migrations versionnées (appliquées au déploiement)
src/
  app.js                   # application Express (testable avec supertest)
  middleware/              # auth JWT (req.auth) + asyncHandler
  routes/                  # auth, org, agent, channels, datasources, transactions
  channels/                # ChannelRegistry + adaptateurs (contrat ChannelAdapter)
  datasources/             # DataSourceRegistry + sources (contrat DataSource)
  ai/                      # AIRegistry + fournisseurs (contrat AIProvider)
  services/                # chatEngine (cœur), sessionStore, ragService (Phase 2)
  db/database.js           # client Prisma singleton
public/                    # frontend statique (Alpine.js + Tailwind CDN)
tests/                     # unit / integration / contract
```

### Base de données (Prisma + SQLite)

- Le schéma vit dans [prisma/schema.prisma](prisma/schema.prisma) ; chaque modification
  passe par `npm run db:migrate` (migration versionnée, commitée dans Git).
- En production, `npx prisma migrate deploy` applique les migrations au démarrage
  (déjà configuré dans [railway.json](railway.json)).
- Champs en `snake_case`, identiques aux colonnes du cahier des charges §6.5.
- Versions épinglées sur **Prisma 6** (`^6`) : Prisma 7 introduit des changements
  majeurs — migration à planifier en équipe, pas par un simple `npm update`.

### Isolation multi-organisation

- **Données** : toutes les requêtes sont filtrées par `org_id` issu du JWT (puis `agent_id`).
- **Sessions WhatsApp** : un dossier par agent dans `SESSIONS_DIR/{agentId}/`.
- **Secrets** : les clés d'API IA sont stockées par agent et **jamais renvoyées au frontend**
  (voir `publicAgent()` dans [src/routes/agent.js](src/routes/agent.js)).

## Étendre la plateforme (guide express)

**Ajouter un canal** (ex. Instagram) :
1. compléter [src/channels/InstagramAdapter.js](src/channels/InstagramAdapter.js) — implémenter
   `start/stop/getStatus/sendMessage/sendMedia` et appeler `this._emitInbound({ agentId, customerId, text })`
   à chaque message entrant ;
2. l'enregistrer dans [src/channels/ChannelRegistry.js](src/channels/ChannelRegistry.js) ;
3. c'est tout — le moteur de conversation ne change pas. Les tests de contrat
   ([tests/contract/interfaces.test.js](tests/contract/interfaces.test.js)) valident automatiquement le nouvel adaptateur.

**Ajouter une source de données** : même démarche avec `DataSource` + `DataSourceRegistry`.
**Ajouter un fournisseur d'IA** : sous-classe d'`AIProvider` qui implémente `_completeWithKey()`
(la logique multi-clés / repli est déjà dans la classe de base) + enregistrement dans `AIRegistry`.

## Variables d'environnement

| Variable | Rôle | Local | Railway |
|---|---|---|---|
| `PORT` | port d'écoute | 3000 | fourni par Railway |
| `JWT_SECRET` | signature des jetons | au choix | **obligatoire**, longue chaîne aléatoire |
| `DATABASE_URL` | base SQLite (Prisma) | `file:../data/botflow.db` | `file:/data/botflow.db` (volume) |
| `SESSIONS_DIR` | sessions WhatsApp | `./sessions` | `/data/sessions` (volume) |

Les clés d'API IA (Groq/Gemini) sont fournies par chaque organisation dans le wizard, stockées en base par agent.

## Tests & CI

- **Unitaires** : parsing de la réponse IA, repli multi-clés, parsing CSV + mapping de colonnes, modèle de données et isolation.
- **Intégration** : register/login, CRUD agents, isolation entre organisations, flux complet message → réponse → transaction → export CSV (IA mockée, zéro réseau).
- **Contrat** : chaque adaptateur enregistré doit respecter son interface.

GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) exécute `npm ci && npm test`
à chaque push sur `main` et sur chaque pull request. La suite de tests crée sa propre
base jetable (`prisma db push` dans [tests/globalSetup.js](tests/globalSetup.js)).

## Déploiement Railway

1. Pousser le repo sur GitHub.
2. [railway.com](https://railway.com) → **New Project → Deploy from GitHub repo** → choisir le repo.
3. Dans le service → **Settings → Volumes → Add Volume**, mount path : `/data`
   (persistance de SQLite + sessions WhatsApp entre les déploiements).
4. **Variables** : `JWT_SECRET`, `DATABASE_URL=file:/data/botflow.db`, `SESSIONS_DIR=/data/sessions`.
5. **Settings → Networking → Generate Domain** pour obtenir l'URL publique.
6. Chaque `git push` sur `main` redéploie automatiquement ; les migrations Prisma
   sont appliquées au démarrage (`npx prisma migrate deploy`, voir railway.json).

⚠️ WhatsApp/Baileys exige un **processus toujours actif** (connexion WebSocket persistante) :
pas de serverless, pas d'hébergeur qui « endort » le service.

## Notes importantes pour l'équipe

- **Modèles Groq** : ceux listés dans le cahier des charges (`llama3-8b-8192`, `mixtral-8x7b-32768`...)
  ont été retirés par Groq. Défaut actuel : `llama-3.1-8b-instant` (configurable par agent).
- **Économie de tokens (offres gratuites)** : les quotas gratuits Groq/Gemini sont en
  tokens/minute. Le moteur est calibré en conséquence (voir constantes en tête de
  [src/services/chatEngine.js](src/services/chatEngine.js)) : 8 lignes de catalogue max en format
  compact `col | col` (~10x moins cher que du JSON), historique limité à 10 messages tronqués,
  réponse plafonnée à 400 tokens, feuille Google mise en cache 60 s, et message de repli poli si
  le quota est quand même atteint (le bot ne reste jamais muet).
- **Google Sheets MVP** : lecture via l'export CSV public — zéro clé d'API requise.
  L'écriture (réservation → Sheet) viendra en Phase 2 avec l'API officielle.
- **bcryptjs** (pur JS) remplace bcrypt (natif) : même API, aucun souci de compilation Windows/CI.
- **Baileys** : utiliser le paquet npm **`baileys`** (v7, lignée maintenue) — l'ancien nom
  `@whiskeysockets/baileys` (6.x, cité dans le cahier des charges) est gelé et ses connexions
  sont rejetées par WhatsApp (fermetures en boucle, aucun QR). Librairie non officielle
  (risque assumé, cahier des charges §12) : l'adaptateur négocie la version du protocole
  (`fetchLatestBaileysVersion`), gère le redémarrage post-scan (`restartRequired`) et
  reconnecte automatiquement (5 tentatives max). Le QR s'affiche dans le wizard (étape 4)
  et dans l'onglet Vue d'ensemble ; le scanner avec un vrai téléphone :
  WhatsApp → Appareils connectés → Connecter un appareil.
