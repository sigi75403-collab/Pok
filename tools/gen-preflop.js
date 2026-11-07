// Erzeugt preflop-data.js: Equity jeder der 169 Starthände gegen 1 und gegen 3 zufällige Gegner.
// Aufruf: node tools/gen-preflop.js [iterationen]
const fs = require('fs');
const path = require('path');
const E = require('../engine.js');

const iters = Number(process.argv[2]) || 30000;
const rows = [];
for (const cls of E.allHandClasses()) {
  const r1 = E.RANKS.indexOf(cls[0]);
  const r2 = E.RANKS.indexOf(cls[1]);
  const suited = cls[2] === 's';
  const hero = [E.makeCard(r1, 0), E.makeCard(r2, suited ? 0 : 1)];
  const eq1 = E.equity({ hero, opponents: [{}], iterations: iters, seed: 7 }).equity;
  const eq3 = E.equity({ hero, opponents: [{}, {}, {}], iterations: iters, seed: 11 }).equity;
  rows.push([cls, +eq1.toFixed(4), +eq3.toFixed(4)]);
}
// Sortierung: Mischung aus Heads-up- und Multiway-Equity (normalisiert)
rows.sort((a, b) => b[1] + b[2] * 2 - (a[1] + a[2] * 2));
const out =
  '// Automatisch erzeugt von tools/gen-preflop.js – nicht von Hand bearbeiten.\n' +
  '// [Hand, Equity vs. 1 Zufallshand, Equity vs. 3 Zufallshände], sortiert nach Stärke.\n' +
  '(function (root) {\n  root.PREFLOP_RANKING = ' +
  JSON.stringify(rows) +
  ';\n  if (typeof module !== "undefined" && module.exports) module.exports = root.PREFLOP_RANKING;\n})(typeof globalThis !== "undefined" ? globalThis : this);\n';
fs.writeFileSync(path.join(__dirname, '..', 'preflop-data.js'), out);
console.log('Top 15:', rows.slice(0, 15).map((r) => r[0]).join(' '));
console.log('Schwächste 5:', rows.slice(-5).map((r) => r[0]).join(' '));
