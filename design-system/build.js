/**
 * Génère les cartes d'aperçu du Design System BotFlow (claude.ai/design).
 * Chaque carte est un HTML autonome : Tailwind CDN + Inter + botflow.css inliné.
 * Usage : node design-system/build.js  -> écrit design-system/cards/<groupe>/<id>.html
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'botflow.css'), 'utf8');

const page = (body, { dark = false } = {}) => `<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config = { theme: { extend: { fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] } } } };</script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>${css}</style>
<body class="${dark ? 'bg-slate-950 text-slate-100' : 'bf-app-bg text-slate-900'} antialiased p-8 font-sans">
${body}
</body>`;

const cards = [
  {
    id: 'foundations/colors',
    name: 'Couleurs',
    group: 'Colors',
    width: 720,
    html: page(`
<div class="max-w-2xl space-y-6">
  <div>
    <p class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Marque</p>
    <div class="grid grid-cols-3 gap-3">
      <div class="h-20 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-500/30 p-3 flex items-end text-xs font-bold text-white">brand gradient</div>
      <div class="h-20 rounded-2xl bg-emerald-400 p-3 flex items-end text-xs font-bold text-emerald-950">emerald-400</div>
      <div class="h-20 rounded-2xl bg-teal-500 p-3 flex items-end text-xs font-bold text-white">teal-500</div>
    </div>
  </div>
  <div>
    <p class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Neutres (slate)</p>
    <div class="grid grid-cols-6 gap-2">
      <div class="h-12 rounded-xl bg-slate-950"></div><div class="h-12 rounded-xl bg-slate-700"></div>
      <div class="h-12 rounded-xl bg-slate-400"></div><div class="h-12 rounded-xl bg-slate-200"></div>
      <div class="h-12 rounded-xl bg-slate-100"></div><div class="h-12 rounded-xl bg-white border border-slate-200"></div>
    </div>
  </div>
  <div>
    <p class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Sémantiques</p>
    <div class="grid grid-cols-4 gap-2">
      <div class="h-12 rounded-xl bg-emerald-500 grid place-items-center text-[11px] font-bold text-white">succès</div>
      <div class="h-12 rounded-xl bg-amber-400 grid place-items-center text-[11px] font-bold text-amber-950">attente</div>
      <div class="h-12 rounded-xl bg-red-500 grid place-items-center text-[11px] font-bold text-white">erreur</div>
      <div class="h-12 rounded-xl bg-sky-500 grid place-items-center text-[11px] font-bold text-white">info</div>
    </div>
  </div>
</div>`),
  },
  {
    id: 'foundations/typography',
    name: 'Typographie',
    group: 'Type',
    width: 720,
    html: page(`
<div class="max-w-2xl space-y-5">
  <div><span class="bf-hint">Display / Inter 900</span><h1 class="text-4xl font-black tracking-tight">Votre agent IA <span class="bf-gradient-text">sur WhatsApp</span></h1></div>
  <div><span class="bf-hint">Titre de page / 800</span><h2 class="font-extrabold tracking-tight text-lg">Vue d'ensemble</h2></div>
  <div><span class="bf-hint">Titre de carte / 800</span><h3 class="font-extrabold tracking-tight">Conversations récentes</h3></div>
  <div><span class="bf-hint">Corps / 400</span><p class="text-sm text-slate-600">Connectez votre site web ou votre Google Sheet : l'IA comprend votre catalogue et répond à vos clients 24h/24.</p></div>
  <div><span class="bf-hint">Label / 600</span><p class="bf-label !mb-0">Domaine ou URL de votre site</p></div>
  <div><span class="bf-hint">Eyebrow / 700 widest</span><p class="text-[11px] font-bold uppercase tracking-widest text-slate-500">Mes agents</p></div>
</div>`),
  },
  {
    id: 'components/buttons',
    name: 'Boutons',
    group: 'Components',
    width: 640,
    html: page(`
<div class="space-y-5 max-w-xl">
  <div class="flex flex-wrap items-center gap-3">
    <button class="bf-btn bf-btn-primary">Analyser la source</button>
    <button class="bf-btn bf-btn-dark">Valider le mapping</button>
    <button class="bf-btn bf-btn-ghost">Actualiser</button>
    <button class="bf-btn bf-btn-danger">Supprimer l'agent</button>
  </div>
  <div class="flex flex-wrap items-center gap-3">
    <button class="bf-btn bf-btn-primary" disabled>Désactivé</button>
    <button class="bf-btn bf-btn-primary">
      <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
      Exploration…
    </button>
    <button class="bf-btn bf-btn-ghost !py-1.5 !px-3 text-xs">Compact</button>
  </div>
</div>`),
  },
  {
    id: 'components/badges',
    name: 'Badges & statuts',
    group: 'Components',
    width: 640,
    html: page(`
<div class="space-y-5 max-w-xl">
  <div class="flex flex-wrap gap-2">
    <span class="bf-badge bf-badge-emerald">Réservation</span>
    <span class="bf-badge bf-badge-blue">Commande</span>
    <span class="bf-badge bf-badge-slate">Demande</span>
    <span class="bf-badge bf-badge-amber">En attente</span>
    <span class="bf-badge bf-badge-red">Annulé</span>
    <span class="bf-badge bf-badge-violet">7 jours</span>
    <span class="bf-badge bf-badge-emerald"><span class="bf-dot bf-dot-live"></span> en ligne</span>
  </div>
  <div class="flex flex-wrap gap-3">
    <select class="bf-status-select bf-status-pending"><option>En attente</option></select>
    <select class="bf-status-select bf-status-confirmed"><option>Confirmé</option></select>
    <select class="bf-status-select bf-status-cancelled"><option>Annulé</option></select>
  </div>
  <div class="flex flex-wrap gap-2">
    <button class="bf-pill bf-pill-active">Toutes</button>
    <button class="bf-pill">En attente</button>
    <button class="bf-pill">Confirmées</button>
    <button class="bf-pill">Annulées</button>
  </div>
</div>`),
  },
  {
    id: 'components/forms',
    name: 'Formulaires',
    group: 'Components',
    width: 640,
    html: page(`
<div class="max-w-md space-y-4">
  <div>
    <label class="bf-label">Domaine ou URL de votre site</label>
    <input class="bf-input" placeholder="monentreprise.ma" />
    <p class="bf-hint mt-1.5">BotFlow explore le domaine, ses sous-domaines et son sitemap.</p>
  </div>
  <div>
    <label class="bf-label">Fournisseur d'IA</label>
    <select class="bf-select"><option>Groq</option><option>Google Gemini</option></select>
  </div>
  <div>
    <label class="bf-label">Description de l'activité</label>
    <textarea class="bf-textarea" rows="3" placeholder="Agence de location de voitures à Casablanca…"></textarea>
  </div>
</div>`),
  },
  {
    id: 'components/cards',
    name: 'Cartes & statistiques',
    group: 'Components',
    width: 760,
    html: page(`
<div class="max-w-2xl space-y-5">
  <div class="grid grid-cols-3 gap-4">
    <div class="bf-card bf-card-hover p-5">
      <span class="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400/15 to-teal-500/15 grid place-items-center mb-4 block">💬</span>
      <div class="text-3xl font-black tracking-tight">24</div>
      <div class="text-sm font-medium text-slate-500 mt-1">Conversations</div>
    </div>
    <div class="bf-card bf-card-hover p-5">
      <span class="w-11 h-11 rounded-xl bg-gradient-to-br from-sky-400/15 to-blue-500/15 grid place-items-center mb-4 block">🧾</span>
      <div class="text-3xl font-black tracking-tight">87</div>
      <div class="text-sm font-medium text-slate-500 mt-1">Réservations</div>
    </div>
    <div class="bf-card bf-card-hover p-5">
      <span class="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-400/15 to-fuchsia-500/15 grid place-items-center mb-4 block">👥</span>
      <div class="text-3xl font-black tracking-tight">31</div>
      <div class="text-sm font-medium text-slate-500 mt-1">Clients actifs</div>
    </div>
  </div>
  <div class="bf-card bf-card-accent p-6">
    <h3 class="font-extrabold tracking-tight mb-1">Carte avec liseré de marque</h3>
    <p class="text-sm text-slate-500">Utilisée pour les sections « héro » : connexion du canal, configuration de la source.</p>
  </div>
</div>`),
  },
  {
    id: 'components/sidebar',
    name: 'Navigation latérale',
    group: 'Components',
    width: 320,
    html: page(`
<div class="w-72 bg-slate-950 text-slate-300 rounded-2xl overflow-hidden">
  <div class="flex items-center gap-2.5 px-5 h-16 border-b border-white/5">
    <span class="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 grid place-items-center text-lg shadow-lg shadow-emerald-500/30">🤖</span>
    <span class="text-lg font-extrabold tracking-tight text-white">Bot<span class="bf-gradient-text">Flow</span></span>
  </div>
  <div class="px-3 py-5 space-y-7">
    <div>
      <div class="px-2 mb-2 flex justify-between text-[11px] font-bold uppercase tracking-widest text-slate-500"><span>Mes agents</span><span>2/3</span></div>
      <button class="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 mb-1 bg-white/10 text-white text-left">
        <span class="relative w-9 h-9 rounded-xl grid place-items-center text-xs font-bold bg-gradient-to-br from-emerald-400 to-teal-500 text-slate-950">BA
          <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-slate-950 bg-emerald-400"></span></span>
        <span><span class="block text-sm font-semibold">Bot Atlas</span><span class="block text-[11px] text-slate-500">WhatsApp connecté</span></span>
      </button>
      <button class="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-white/5">
        <span class="relative w-9 h-9 rounded-xl grid place-items-center text-xs font-bold bg-white/10">RS
          <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-slate-950 bg-slate-600"></span></span>
        <span><span class="block text-sm font-semibold">Riad Salam</span><span class="block text-[11px] text-slate-500">Hors ligne</span></span>
      </button>
    </div>
    <div>
      <div class="px-2 mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">Menu</div>
      <a class="flex items-center gap-3 rounded-xl px-3 py-2.5 mb-1 text-sm font-semibold bg-gradient-to-r from-emerald-500/25 to-teal-500/10 text-emerald-300">▦ Vue d'ensemble<span class="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400"></span></a>
      <a class="flex items-center gap-3 rounded-xl px-3 py-2.5 mb-1 text-sm font-semibold text-slate-400 hover:bg-white/5">🧾 Transactions</a>
      <a class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 hover:bg-white/5">🗄️ Données</a>
    </div>
  </div>
</div>`, { dark: true }),
  },
  {
    id: 'components/table',
    name: 'Tableau de données',
    group: 'Components',
    width: 760,
    html: page(`
<div class="bf-card p-4 max-w-2xl">
  <table class="bf-table w-full">
    <thead><tr><th>type</th><th>name</th><th>price</th><th>category</th></tr></thead>
    <tbody>
      <tr><td><span class="bf-badge bf-badge-emerald">produit</span></td><td>Dacia Logan</td><td>250 DH/jour</td><td>Économique</td></tr>
      <tr><td><span class="bf-badge bf-badge-emerald">produit</span></td><td>Renault Clio</td><td>300 DH/jour</td><td>Citadine</td></tr>
      <tr><td><span class="bf-badge bf-badge-blue">categorie</span></td><td>SUV & 4x4</td><td>—</td><td>—</td></tr>
      <tr><td><span class="bf-badge bf-badge-amber">contact</span></td><td>Agence Casablanca</td><td>—</td><td>+212 522 00 00 00</td></tr>
    </tbody>
  </table>
</div>`),
  },
  {
    id: 'components/loading',
    name: 'Chargement (squelettes)',
    group: 'Components',
    width: 640,
    html: page(`
<div class="bf-card p-6 max-w-xl space-y-4">
  <div class="flex items-center gap-3">
    <div class="bf-skeleton w-10 h-10 !rounded-full"></div>
    <div class="flex-1 space-y-2"><div class="bf-skeleton h-3.5 w-40"></div><div class="bf-skeleton h-3 w-72"></div></div>
  </div>
  <div class="bf-skeleton h-9 w-24"></div>
  <div class="bf-skeleton h-10 w-full"></div>
  <div class="bf-skeleton h-10 w-full"></div>
</div>`),
  },
  {
    id: 'brand/chat-preview',
    name: 'Aperçu conversation',
    group: 'Brand',
    width: 460,
    html: page(`
<div class="bf-float bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-5 max-w-sm">
  <div class="flex items-center gap-2.5 mb-4">
    <span class="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 grid place-items-center text-[10px] font-bold text-slate-950">BA</span>
    <div>
      <p class="text-sm font-semibold leading-none">Bot Atlas</p>
      <p class="text-[11px] text-emerald-400 mt-1 flex items-center gap-1"><span class="bf-dot bf-dot-live"></span> en ligne · répond en 3 s</p>
    </div>
  </div>
  <div class="space-y-2.5 text-[13px]">
    <p class="bg-white/10 rounded-2xl rounded-bl-md px-3.5 py-2 w-fit max-w-[85%]">wach kayna chi tomobil l'weekend ?</p>
    <p class="bg-emerald-500/90 text-slate-950 font-medium rounded-2xl rounded-br-md px-3.5 py-2 w-fit max-w-[85%] ml-auto">Wakha ! 3andna Dacia Logan b 250 DH/jour, disponible samedi. Nreserviha lik ? 🚗</p>
    <p class="bg-white/10 rounded-2xl rounded-bl-md px-3.5 py-2 w-fit max-w-[85%]">safi reserviha liya</p>
    <p class="bg-emerald-500/90 text-slate-950 font-medium rounded-2xl rounded-br-md px-3.5 py-2 w-fit max-w-[85%] ml-auto">Réservation confirmée ✅ Samedi → dimanche, Dacia Logan.</p>
  </div>
</div>`, { dark: true }),
  },
];

const outDir = path.join(__dirname, 'cards');
fs.rmSync(outDir, { recursive: true, force: true });
for (const card of cards) {
  const file = path.join(outDir, card.id + '.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const marker = `<!-- @dsCard group="${card.group}" name="${card.name}" width="${card.width}" -->\n`;
  fs.writeFileSync(file, marker + card.html, 'utf8');
  console.log('écrit', path.relative(process.cwd(), file));
}
console.log(cards.length + ' cartes générées.');
