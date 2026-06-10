const GoogleSheetsSource = require('../../src/datasources/GoogleSheetsSource');
const { parseCsv, guessColumnMeaning } = GoogleSheetsSource;

describe('parseCsv', () => {
  test('CSV simple', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('champs entre guillemets avec virgules et sauts de ligne', () => {
    const csv = 'nom,desc\n"Logan","Berline, 5 places\nclim incluse"';
    expect(parseCsv(csv)).toEqual([
      ['nom', 'desc'],
      ['Logan', 'Berline, 5 places\nclim incluse'],
    ]);
  });

  test('guillemets échappés ("") et lignes vides ignorées', () => {
    const csv = 'a,b\n"dit ""bonjour""",x\n\n,';
    expect(parseCsv(csv)).toEqual([
      ['a', 'b'],
      ['dit "bonjour"', 'x'],
    ]);
  });
});

describe('guessColumnMeaning — détection heuristique des colonnes', () => {
  test.each([
    ['Nom du véhicule', 'name'],
    ['Prix / jour (DH)', 'price'],
    ['Ville', 'city'],
    ['Catégorie', 'category'],
    ['Disponible', 'availability'],
    ['Photo', 'image_url'],
    ['Description', 'description'],
    ['Référence interne', 'other'],
  ])('"%s" -> %s', (header, expected) => {
    expect(guessColumnMeaning(header)).toBe(expected);
  });

  test('détecte une colonne image par son CONTENU (URL .jpg)', () => {
    expect(guessColumnMeaning('Lien', ['https://site.ma/logan.jpg'])).toBe('image_url');
  });
});

describe('GoogleSheetsSource — URL et analyse', () => {
  const URL_OK = 'https://docs.google.com/spreadsheets/d/1AbC-dEf_123/edit#gid=42';

  test('extrait l\'identifiant de la feuille et construit l\'URL CSV (avec gid)', () => {
    const src = new GoogleSheetsSource({ ref: URL_OK });
    expect(src.spreadsheetId()).toBe('1AbC-dEf_123');
    expect(src.csvUrl()).toBe('https://docs.google.com/spreadsheets/d/1AbC-dEf_123/export?format=csv&gid=42');
  });

  test('URL invalide : erreur 400 explicite', () => {
    const src = new GoogleSheetsSource({ ref: 'https://exemple.com/pas-un-sheet' });
    expect(() => src.spreadsheetId()).toThrow(/URL Google Sheets invalide/);
  });

  test('analyze() : 5 lignes d\'échantillon + mapping détecté', async () => {
    const src = new GoogleSheetsSource({ ref: URL_OK });
    src.fetchTable = async () => ({
      headers: ['Nom', 'Prix', 'Ville'],
      records: Array.from({ length: 8 }, (_, i) => ({ Nom: 'V' + i, Prix: String(100 + i), Ville: 'Casa' })),
    });
    const analysis = await src.analyze();
    expect(analysis.sample).toHaveLength(5);
    expect(analysis.rowCount).toBe(8);
    expect(analysis.mapping).toEqual({ Nom: 'name', Prix: 'price', Ville: 'city' });
  });

  test('search() : filtre par mots-clés avec repli sur les premières lignes', async () => {
    const src = new GoogleSheetsSource({ ref: URL_OK });
    src.fetchTable = async () => ({
      headers: ['Nom', 'Ville'],
      records: [
        { Nom: 'Dacia Logan', Ville: 'Casablanca' },
        { Nom: 'Renault Clio', Ville: 'Agadir' },
        { Nom: 'Hyundai i10', Ville: 'Casablanca' },
      ],
    });
    const hits = await src.search('voiture à agadir');
    expect(hits[0].Nom).toBe('Renault Clio');

    // aucun terme ne matche -> repli : on renvoie quand même du contexte
    const fallback = await src.search('xyzxyz');
    expect(fallback.length).toBe(3);
  });

  test('write() : refusée en MVP (feuille publique en lecture seule)', async () => {
    const src = new GoogleSheetsSource({ ref: URL_OK });
    await expect(src.write({})).rejects.toThrow(/Phase 2/);
  });

  test('cache : fetchTable ne retélécharge pas la feuille à chaque message', async () => {
    const src = new GoogleSheetsSource({
      ref: 'https://docs.google.com/spreadsheets/d/CacheTest123/edit',
    });
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return { ok: true, text: async () => 'a,b\n1,2' };
    };
    try {
      await src.fetchTable();
      await src.fetchTable();
      expect(calls).toBe(1); // 2e lecture servie par le cache
      await src.fetchTable({ fresh: true });
      expect(calls).toBe(2); // fresh force la relecture
    } finally {
      global.fetch = originalFetch;
    }
  });
});
