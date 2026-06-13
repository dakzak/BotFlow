/**
 * Socle commun des pages privées BotFlow (multi-pages).
 * Chaque page construit son composant Alpine avec :
 *   { ...baseApp('id-de-la-page'), ...état et méthodes propres à la page }
 * et définit éventuellement onAgentChange() — appelé quand l'utilisateur
 * change d'agent dans la barre latérale.
 *
 * L'agent sélectionné est partagé entre les pages via localStorage.
 */
function baseApp(page) {
  return {
    page,
    token: localStorage.getItem('botflow_token'),
    org: null,
    agents: [],
    current: null,
    error: '',
    sidebarOpen: false,
    tabs: [
      { id: 'dashboard', href: '/dashboard.html', label: "Vue d'ensemble" },
      { id: 'transactions', href: '/transactions.html', label: 'Transactions' },
      { id: 'donnees', href: '/donnees.html', label: 'Données' },
      { id: 'parametres', href: '/parametres.html', label: 'Paramètres' },
    ],
    /* Icônes du menu latéral (Heroicons outline 24px, trait 1.8). */
    navIcons: {
      dashboard:
        '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"/></svg>',
      transactions:
        '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>',
      donnees:
        '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"/></svg>',
      parametres:
        '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>',
    },

    /** Appel API authentifié ; redirige vers la connexion si le jeton est invalide. */
    async api(path, opts = {}) {
      const resp = await fetch('/api' + path, {
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.token },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      if (resp.status === 401) {
        localStorage.removeItem('botflow_token');
        location.href = '/login.html';
        throw new Error('Session expirée');
      }
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Erreur ' + resp.status);
      return data;
    },

    /** Charge l'organisation, les agents et restaure l'agent sélectionné. */
    async initBase() {
      if (!this.token) {
        location.href = '/login.html';
        return false;
      }
      try {
        this.org = await this.api('/org');
        await this.loadAgents();
        const savedId = localStorage.getItem('botflow_agent_id');
        this.current = this.agents.find((a) => a.id === savedId) || this.agents[0] || null;
        if (this.current) localStorage.setItem('botflow_agent_id', this.current.id);
        return true;
      } catch (err) {
        this.error = err.message;
        return false;
      }
    },

    async loadAgents() {
      this.agents = await this.api('/agents');
    },

    selectAgent(agent) {
      this.current = agent;
      localStorage.setItem('botflow_agent_id', agent.id);
      this.error = '';
      if (this.onAgentChange) this.onAgentChange();
    },

    logout() {
      localStorage.removeItem('botflow_token');
      localStorage.removeItem('botflow_agent_id');
      location.href = '/login.html';
    },

    statusLabel(status) {
      return {
        disconnected: 'Déconnecté',
        connecting: 'Connexion...',
        qr_ready: 'QR prêt — scannez-le',
        connected: 'Connecté ✅',
      }[status] || status;
    },

    formatDate(d) {
      if (!d) return '';
      return new Date(String(d).includes('T') ? d : d + 'Z').toLocaleString('fr-FR');
    },

    /** Initiales pour les avatars (« Dak Ouky » -> « DO », numéro -> 2 derniers chiffres). */
    initials(name) {
      const s = String(name || '').trim();
      if (!s) return '?';
      if (/^[0-9@+: .-]+$/.test(s)) return s.replace(/\D/g, '').slice(-2) || '#';
      return s.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    },
  };
}
