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
    tabs: [
      { id: 'dashboard', href: '/dashboard.html', label: "Vue d'ensemble" },
      { id: 'transactions', href: '/transactions.html', label: 'Transactions' },
      { id: 'donnees', href: '/donnees.html', label: 'Données' },
      { id: 'parametres', href: '/parametres.html', label: 'Paramètres' },
    ],

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
  };
}
