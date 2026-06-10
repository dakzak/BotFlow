const AIProvider = require('./AIProvider');

/**
 * Fournisseur Groq — API compatible OpenAI.
 * NB : les modèles listés dans le cahier des charges (llama3-8b-8192, mixtral...)
 * ont été retirés par Groq ; modèles actuels : llama-3.1-8b-instant,
 * llama-3.3-70b-versatile... Le modèle reste configurable par agent.
 */
class GroqProvider extends AIProvider {
  constructor() {
    super('groq', 'llama-3.1-8b-instant');
  }

  async _completeWithKey(messages, { apiKey, model, maxTokens = 1024, temperature = 0.4 }) {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Groq HTTP ${resp.status} : ${body.slice(0, 200)}`);
    }
    const json = await resp.json();
    return json.choices?.[0]?.message?.content || '';
  }
}

module.exports = new GroqProvider();
