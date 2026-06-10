const { parseAIResponse, buildSystemPrompt, compactRows } = require('../../src/services/chatEngine');

describe('parseAIResponse — extraction du bloc transaction', () => {
  test('réponse texte simple : pas d\'action, pas de média', () => {
    const r = parseAIResponse('Bonjour ! Nous avons 3 véhicules disponibles à Casablanca.');
    expect(r.text).toBe('Bonjour ! Nous avons 3 véhicules disponibles à Casablanca.');
    expect(r.action).toBeNull();
    expect(r.mediaUrl).toBeNull();
  });

  test('bloc ```json clôturé : action extraite et texte nettoyé', () => {
    const raw = [
      'Parfait, votre réservation est confirmée !',
      '```json',
      '{"action": "reservation", "data": {"vehicule": "Dacia Logan", "ville": "Casablanca", "jours": 3}}',
      '```',
    ].join('\n');
    const r = parseAIResponse(raw);
    expect(r.text).toBe('Parfait, votre réservation est confirmée !');
    expect(r.action).toEqual({
      action: 'reservation',
      data: { vehicule: 'Dacia Logan', ville: 'Casablanca', jours: 3 },
    });
  });

  test('JSON brut en fin de réponse (sans clôture)', () => {
    const raw = 'Commande enregistrée.\n{"action": "order", "data": {"produit": "Tajine", "quantite": 2}}';
    const r = parseAIResponse(raw);
    expect(r.text).toBe('Commande enregistrée.');
    expect(r.action.action).toBe('order');
    expect(r.action.data.quantite).toBe(2);
  });

  test('données imbriquées dans le bloc JSON', () => {
    const raw = 'OK.\n{"action": "reservation", "data": {"client": {"nom": "Ali"}, "dates": ["2026-07-01", "2026-07-03"]}}';
    const r = parseAIResponse(raw);
    expect(r.action.data.client.nom).toBe('Ali');
    expect(r.action.data.dates).toHaveLength(2);
  });

  test('image extraite du bloc JSON', () => {
    const raw = 'Voici la Dacia Logan.\n```json\n{"action": "inquiry", "data": {}, "image": "https://exemple.com/logan.jpg"}\n```';
    const r = parseAIResponse(raw);
    expect(r.mediaUrl).toBe('https://exemple.com/logan.jpg');
  });

  test('action "none" ignorée', () => {
    const raw = 'Bonne journée !\n```json\n{"action": "none"}\n```';
    const r = parseAIResponse(raw);
    expect(r.action).toBeNull();
  });

  test('JSON malformé : la réponse texte survit', () => {
    const raw = 'Réponse au client.\n```json\n{"action": "reservation", "data": {INVALIDE}\n```';
    const r = parseAIResponse(raw);
    expect(r.text).toBe('Réponse au client.');
    expect(r.action).toBeNull();
  });

  test('entrée vide ou non-string', () => {
    expect(parseAIResponse('').text).toBe('');
    expect(parseAIResponse(null).action).toBeNull();
    expect(parseAIResponse(undefined).mediaUrl).toBeNull();
  });

  test('des accolades dans le texte normal ne déclenchent pas de fausse action', () => {
    const raw = 'Nos prix {selon saison} varient. Contactez-nous !';
    const r = parseAIResponse(raw);
    expect(r.text).toBe(raw);
    expect(r.action).toBeNull();
  });
});

describe('buildSystemPrompt', () => {
  const agent = {
    id: 'a1',
    name: 'Bot Atlas',
    description: 'Location de voitures à Casablanca',
    business_type: 'car_rental',
    sheet_analysis: JSON.stringify({ mapping: { Voiture: 'name', Prix: 'price' } }),
  };

  test('contient l\'identité, le métier et le contexte données', () => {
    const prompt = buildSystemPrompt(agent, [{ Voiture: 'Logan', Prix: '250' }]);
    expect(prompt).toContain('Bot Atlas');
    expect(prompt).toContain('Location de voitures à Casablanca');
    expect(prompt).toContain('car_rental');
    expect(prompt).toContain('Logan');
    expect(prompt).toContain('"action"');
  });

  test('signale l\'absence de données plutôt que de laisser l\'IA inventer', () => {
    const prompt = buildSystemPrompt({ ...agent, sheet_analysis: null }, []);
    expect(prompt).toContain('Aucune donnée catalogue');
  });
});

describe('compactRows — économie de tokens sur les offres gratuites', () => {
  test('format compact : en-têtes une fois, valeurs séparées par |', () => {
    const out = compactRows([
      { Nom: 'Logan', Prix: '250' },
      { Nom: 'Clio', Prix: '300' },
    ]);
    expect(out).toBe('Nom | Prix\nLogan | 250\nClio | 300');
  });

  test('limite le nombre de lignes injectées dans le prompt', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ Nom: 'V' + i }));
    const out = compactRows(rows, { maxRows: 8 });
    expect(out.split('\n')).toHaveLength(9); // 1 en-tête + 8 lignes
  });

  test('omet les colonnes vides et tronque les cellules longues', () => {
    const out = compactRows([
      { Nom: 'Logan', Vide: '', Desc: 'x'.repeat(300) },
      { Nom: 'Clio', Vide: '', Desc: 'courte' },
    ]);
    expect(out).not.toContain('Vide');
    expect(out).toContain('…');
    expect(out.length).toBeLessThan(300);
  });

  test('ne tronque JAMAIS les URL (nécessaires pour envoyer les images)', () => {
    const url = 'https://exemple.com/' + 'a'.repeat(150) + '.jpg';
    const out = compactRows([{ Photo: url }]);
    expect(out).toContain(url);
  });

  test('entrée vide -> chaîne vide', () => {
    expect(compactRows([])).toBe('');
    expect(compactRows(null)).toBe('');
  });
});
