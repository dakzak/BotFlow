const {
  parseAIResponse,
  buildSystemPrompt,
  compactRows,
  parseISODate,
  extractBooking,
  findConflict,
  detectLanguage,
  cleanActionData,
} = require('../../src/services/chatEngine');

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

  test('clôture ```json OUVERTE mais jamais fermée : action extraite, texte propre', () => {
    const raw = 'Réservation confirmée !\n```json\n{"action": "order", "data": {"produit": "Tajine"}}';
    const r = parseAIResponse(raw);
    expect(r.text).toBe('Réservation confirmée !');
    expect(r.action.action).toBe('order');
  });

  test('clôture ouverte avec JSON tronqué : le client ne voit JAMAIS de ```', () => {
    const raw = 'Voici nos voitures disponibles.\n```json\n{"action": "reserv';
    const r = parseAIResponse(raw);
    expect(r.text).toBe('Voici nos voitures disponibles.');
    expect(r.text).not.toContain('```');
    expect(r.action).toBeNull();
  });

  test('restes de ``` isolés : nettoyés du texte final', () => {
    const r = parseAIResponse('Bonne journée !\n```');
    expect(r.text).toBe('Bonne journée !');
  });
});

describe('detectLanguage — suivi de la langue de chaque client', () => {
  test('écriture arabe -> darija/arabe', () => {
    expect(detectLanguage('واش كاينة طوموبيل اليوم؟')).toContain('écriture arabe');
  });

  test('darija en alphabet latin', () => {
    expect(detectLanguage('wach kayna chi tomobil disponible ?')).toBe('darija marocaine (alphabet latin)');
    expect(detectLanguage('wakha nakhdha la Clio')).toBe('darija marocaine (alphabet latin)');
  });

  test('anglais', () => {
    expect(detectLanguage('How much is the car per day?')).toBe('anglais');
  });

  test('français par défaut', () => {
    expect(detectLanguage('Bonjour, je veux louer une voiture à Casablanca')).toBe('français');
  });
});

describe('cleanActionData — jamais de champs vides en base', () => {
  test('retire "" / null / undefined, garde le reste', () => {
    expect(cleanActionData({
      item: 'Dacia Logan',
      start_date: '',
      end_date: '  ',
      ville: null,
      prix: 250,
      note: undefined,
    })).toEqual({ item: 'Dacia Logan', prix: 250 });
  });

  test('entrée absente -> objet vide', () => {
    expect(cleanActionData(null)).toEqual({});
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

  test('exige les dates avant confirmation et impose le format AAAA-MM-JJ', () => {
    const prompt = buildSystemPrompt(agent, []);
    expect(prompt).toContain('Date du jour :');
    expect(prompt).toContain('date de début');
    expect(prompt).toContain('"start_date"');
    expect(prompt).toContain('AAAA-MM-JJ');
  });

  test('injecte les réservations existantes pour que l\'IA connaisse les indisponibilités', () => {
    const bookings = [
      { item: 'Dacia Logan', start: parseISODate('2026-06-12'), end: parseISODate('2026-06-15') },
    ];
    const prompt = buildSystemPrompt(agent, [], bookings);
    expect(prompt).toContain('RÉSERVATIONS DÉJÀ ENREGISTRÉES');
    expect(prompt).toContain('Dacia Logan | 2026-06-12 | 2026-06-15');
  });

  test('aucune section réservations quand il n\'y en a pas', () => {
    const prompt = buildSystemPrompt(agent, []);
    expect(prompt).not.toContain('RÉSERVATIONS DÉJÀ ENREGISTRÉES');
  });
});

describe('parseISODate — dates strictes AAAA-MM-JJ', () => {
  test('date valide', () => {
    expect(parseISODate('2026-06-12').toISOString()).toBe('2026-06-12T00:00:00.000Z');
  });

  test('formats invalides rejetés', () => {
    expect(parseISODate('12/06/2026')).toBeNull();
    expect(parseISODate('demain')).toBeNull();
    expect(parseISODate('2026-6-12')).toBeNull();
    expect(parseISODate(null)).toBeNull();
  });

  test('dates impossibles rejetées (pas de débordement sur le mois suivant)', () => {
    expect(parseISODate('2026-02-31')).toBeNull();
    expect(parseISODate('2026-13-01')).toBeNull();
  });
});

describe('extractBooking — lecture tolérante du data de transaction', () => {
  test('champs nominaux item / start_date / end_date', () => {
    const b = extractBooking({ item: 'Dacia Logan', start_date: '2026-06-12', end_date: '2026-06-15' });
    expect(b.item).toBe('Dacia Logan');
    expect(b.start.toISOString()).toContain('2026-06-12');
    expect(b.end.toISOString()).toContain('2026-06-15');
  });

  test('variantes de nommage de l\'IA tolérées (vehicule, date_debut...)', () => {
    const b = extractBooking({ vehicule: 'Clio', date_debut: '2026-07-01', date_fin: '2026-07-03' });
    expect(b.item).toBe('Clio');
  });

  test('date unique : début = fin (réservation d\'un jour, commande, rendez-vous)', () => {
    const b = extractBooking({ service: 'Coupe homme', date: '2026-06-20' });
    expect(b.start.getTime()).toBe(b.end.getTime());
  });

  test('null si dates absentes, invalides ou inversées', () => {
    expect(extractBooking({ item: 'Logan' })).toBeNull();
    expect(extractBooking({ item: 'Logan', start_date: 'demain' })).toBeNull();
    expect(extractBooking({ item: 'Logan', start_date: '2026-06-15', end_date: '2026-06-12' })).toBeNull();
    expect(extractBooking(null)).toBeNull();
  });
});

describe('findConflict — détection de chevauchement de réservations', () => {
  const bookings = [
    { item: 'Dacia Logan', start: parseISODate('2026-06-12'), end: parseISODate('2026-06-15') },
    { item: 'Dacia Logan', start: parseISODate('2026-06-20'), end: parseISODate('2026-06-22') },
    { item: 'Clio', start: parseISODate('2026-06-12'), end: parseISODate('2026-06-15') },
  ];
  const req = (item, start, end) => ({ item, start: parseISODate(start), end: parseISODate(end) });

  test('chevauchement détecté : disponible le lendemain de la fin existante', () => {
    const c = findConflict(bookings, req('Dacia Logan', '2026-06-14', '2026-06-18'));
    expect(c).not.toBeNull();
    expect(c.nextAvailable.toISOString()).toContain('2026-06-16');
  });

  test('même élément à la casse / espaces près', () => {
    expect(findConflict(bookings, req('  dacia   LOGAN ', '2026-06-13', '2026-06-13'))).not.toBeNull();
  });

  test('pas de conflit : autre élément ou période libre', () => {
    expect(findConflict(bookings, req('Duster', '2026-06-12', '2026-06-15'))).toBeNull();
    expect(findConflict(bookings, req('Dacia Logan', '2026-06-16', '2026-06-19'))).toBeNull();
  });

  test('dates adjacentes : rendre le 15, reprendre le 16 — pas de conflit', () => {
    expect(findConflict(bookings, req('Dacia Logan', '2026-06-16', '2026-06-17'))).toBeNull();
  });

  test('les réservations du client demandeur sont ignorées (répétition / modification)', () => {
    const own = [
      { item: 'Dacia Logan', start: parseISODate('2026-06-12'), end: parseISODate('2026-06-15'), customerId: 'c1' },
    ];
    const demande = req('Dacia Logan', '2026-06-13', '2026-06-14');
    expect(findConflict(own, demande, { excludeCustomerId: 'c1' })).toBeNull();
    expect(findConflict(own, demande, { excludeCustomerId: 'c2' })).not.toBeNull();
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
