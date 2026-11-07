// Ausführen mit: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const E = require('../engine.js');

const ev = (s) => E.evaluate(E.parseCards(s));
const cat = (s) => E.scoreCategory(ev(s));

test('Kategorien werden erkannt', () => {
  assert.strictEqual(cat('AsKsQsJsTs2c3d'), 8);
  assert.strictEqual(cat('As2s3s4s5s9c9d'), 8); // Steel Wheel
  assert.strictEqual(cat('9c9d9h9sAs2c3d'), 7);
  assert.strictEqual(cat('9c9d9hAsAd2c3d'), 6);
  assert.strictEqual(cat('9c9d9hAsAdAc3d'), 6); // zwei Drillinge
  assert.strictEqual(cat('2s7s9sJsKs2c3d'), 5);
  assert.strictEqual(cat('As2c3d4h5s9c9d'), 4); // Wheel
  assert.strictEqual(cat('Ts9c8d7h6s2c2d'), 3 + 1); // Straße schlägt Paar
  assert.strictEqual(cat('7c7d7hAsKd2c3d'), 3);
  assert.strictEqual(cat('7c7dAhAsKd2c3d'), 2);
  assert.strictEqual(cat('7c7dAhQsKd2c3d'), 1);
  assert.strictEqual(cat('7c9dAhQsKd2c3d'), 0);
});

test('Vergleiche innerhalb einer Kategorie', () => {
  assert.ok(ev('AsAdKc7h5s2c3d') > ev('AsAdQc7h5s2c3d')); // Kicker
  assert.ok(ev('6s5d4c3h2s') > ev('As2c3d4h5s')); // 6-hohe Straße > Wheel
  assert.ok(ev('KsKdKh2c2d') > ev('QsQdQhAcAd'));
  assert.ok(ev('AsAdAhKcKdQcQd') === ev('AsAdAhKcKd2c3d')); // beste 5 zählen
  assert.ok(ev('AhKhQhJh9h') > ev('AsKsQsJs8s'));
  assert.strictEqual(ev('AsKdQc9h7s'), ev('AhKcQd9s7c')); // Split
});

test('Beschreibung auf Deutsch', () => {
  assert.strictEqual(E.describe(ev('AsKsQsJsTs')), 'Royal Flush');
  assert.strictEqual(E.describe(ev('AsAdAh8c8d')), 'Full House: Asse über Achten');
  assert.strictEqual(E.describe(ev('As2c3d4h5s')), 'Straße bis Fünf');
});

test('Alle 7462 verschiedenen 5-Karten-Werte', () => {
  // Klassischer Test: Anzahl Hände pro Kategorie über alle 2.598.960 Kombos
  const expected = [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40];
  const counts = new Array(9).fill(0);
  const c = [0, 0, 0, 0, 0];
  for (c[0] = 0; c[0] < 48; c[0]++)
    for (c[1] = c[0] + 1; c[1] < 49; c[1]++)
      for (c[2] = c[1] + 1; c[2] < 50; c[2]++)
        for (c[3] = c[2] + 1; c[3] < 51; c[3]++)
          for (c[4] = c[3] + 1; c[4] < 52; c[4]++) counts[E.scoreCategory(E.evaluate(c))]++;
  assert.deepStrictEqual(counts, expected);
});

test('Equity bekannter Duelle', () => {
  const opp = (s) => [{ cards: E.parseCards(s) }];
  const r1 = E.equity({ hero: E.parseCards('AsAh'), opponents: opp('KsKh'), iterations: 40000, seed: 1 });
  assert.ok(Math.abs(r1.equity - 0.82) < 0.015, 'AA vs KK ≈ 82%: ' + r1.equity);
  const r2 = E.equity({ hero: E.parseCards('AsKd'), opponents: opp('2c2h'), iterations: 40000, seed: 2 });
  assert.ok(Math.abs(r2.equity - 0.47) < 0.02, 'AKo vs 22 ≈ 47%: ' + r2.equity);
  const r3 = E.equity({ hero: E.parseCards('AsAh'), opponents: [{}], iterations: 40000, seed: 3 });
  assert.ok(Math.abs(r3.equity - 0.852) < 0.015, 'AA vs random ≈ 85%: ' + r3.equity);
  // River: deterministisch
  const r4 = E.equity({
    hero: E.parseCards('AsKs'),
    board: E.parseCards('QsJsTs2c3d'),
    opponents: opp('AhAd'),
    iterations: 100,
  });
  assert.strictEqual(r4.equity, 1);
});

test('Outs: Flush-Draw + Overcards', () => {
  const r = E.outs(E.parseCards('AhKh'), E.parseCards('7h2h9c'));
  // 9 Flush-Outs + 3 Asse + 3 Könige = 15
  assert.strictEqual(r.outs.length, 15);
  assert.strictEqual(r.unseen, 47);
  assert.ok(Math.abs(E.hitProbability(15, 47, 2) - 0.5416) < 0.001);
});

test('Draws werden erkannt', () => {
  assert.deepStrictEqual(E.draws(E.parseCards('9s8d'), E.parseCards('7c6h2s')), ['Open-Ended Straight Draw (8 Outs)']);
  assert.deepStrictEqual(E.draws(E.parseCards('9s5d'), E.parseCards('7c6h2s')), ['Gutshot (4 Outs)']);
  assert.ok(E.draws(E.parseCards('AhKh'), E.parseCards('7h2h9c')).includes('Nut-Flush-Draw'));
});

test('Ranges', () => {
  const r = E.topRange(10);
  assert.ok(r.has('AA') && r.has('KK') && r.has('AKs'));
  assert.ok(!r.has('72o'));
  assert.strictEqual(E.topRange(100).size, 169);
  assert.strictEqual(E.allHandClasses().length, 169);
});

test('Board-Verbindung und Postflop-Filter', () => {
  const b = E.parseCards('Kh9c4d');
  const bc = (s) => { const [x, y] = E.parseCards(s); return E.boardConnection(x, y, b); };
  assert.strictEqual(bc('KsQd'), 2); // Top Pair
  assert.strictEqual(bc('Ks9s'), 3); // Zwei Paare
  assert.strictEqual(bc('QhJh'), 0); // nichts (Backdoor zählt nicht)
  assert.strictEqual(bc('JsTs'), 0); // Gutshot zählt nicht
  assert.strictEqual(bc('7c2d'), 0);
  // Gegen einen Gegner, der nie blufft, sinkt die Equity von Top Pair deutlich
  const hero = E.parseCards('KdTd');
  const free = E.equity({ hero, board: b, opponents: [{}], iterations: 20000, seed: 5 }).equity;
  const honest = E.equity({ hero, board: b, opponents: [{ postflop: { need: 1, bluff: 0 } }], iterations: 20000, seed: 5 }).equity;
  assert.ok(free - honest > 0.08, `ohne Filter ${free}, ehrlicher Bettor ${honest}`);
});
