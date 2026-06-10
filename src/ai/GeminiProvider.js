const AIProvider = require('./AIProvider');

/** Fournisseur Google Gemini — API generateContent. */
class GeminiProvider extends AIProvider {
  constructor() {
    super('gemini', 'gemini-2.0-flash');
  }

  async _completeWithKey(messages, { apiKey, model, maxTokens = 1024, temperature = 0.4 }) {
    // Gemini sépare l'instruction système des tours de conversation,
    // et nomme les rôles user/model (pas assistant).
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const body = {
      contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Gemini HTTP ${resp.status} : ${text.slice(0, 200)}`);
    }
    const json = await resp.json();
    return json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  }
}

module.exports = new GeminiProvider();
