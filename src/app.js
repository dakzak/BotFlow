const express = require('express');
const path = require('path');

const authRoutes = require('./routes/auth');
const orgRoutes = require('./routes/org');
const agentRoutes = require('./routes/agent');
const channelRoutes = require('./routes/channels');
const datasourceRoutes = require('./routes/datasources');
const transactionRoutes = require('./routes/transactions');

/**
 * Construit l'application Express (sans l'écoute réseau),
 * ce qui permet de la tester avec supertest.
 */
function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.use('/api', authRoutes); // /api/register, /api/login
  app.use('/api/org', orgRoutes);
  app.use('/api/agents', agentRoutes);
  app.use('/api/agents', channelRoutes); // /api/agents/:id/channel/*
  app.use('/api/agents', datasourceRoutes); // /api/agents/:id/datasource/*
  app.use('/api', transactionRoutes); // /api/agents/:id/transactions, /api/transactions/:id

  // Gestion d'erreurs centralisée : toute erreur levée dans une route arrive ici
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[api]', err);
    res.status(status).json({ error: err.message || 'Erreur interne' });
  });

  return app;
}

module.exports = { createApp };
