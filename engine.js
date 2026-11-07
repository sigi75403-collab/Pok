/*
 * Poker-Engine: Handbewertung, Equity (Monte Carlo / exakt), Outs, Ranges.
 * Läuft im Browser (window.PokerEngine) und in Node (module.exports).
 *
 * Kartenkodierung: 0..51, rank = c >> 2 (0 = 2 ... 12 = A), suit = c & 3.
 */
(function (root) {
  'use strict';

  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc'; // pik, herz, karo, kreuz
  const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const RANK_NAMES_DE = ['Zwei', 'Drei', 'Vier', 'Fünf', 'Sechs', 'Sieben', 'Acht', 'Neun', 'Zehn', 'Bube', 'Dame', 'König', 'Ass'];
  const RANK_PLURAL_DE = ['Zweien', 'Dreien', 'Vieren', 'Fünfen', 'Sechsen', 'Siebenen', 'Achten', 'Neunen', 'Zehnen', 'Buben', 'Damen', 'Könige', 'Asse'];

  const CATEGORY_NAMES = [
    'High Card',
    'Ein Paar',
    'Zwei Paare',
    'Drilling',
    'Straße',
    'Flush',
    'Full House',
    'Vierling',
    'Straight Flush',
  ];

  const cardRank = (c) => c >> 2;
  const cardSuit = (c) => c & 3;
  const makeCard = (rank, suit) => (rank << 2) | suit;

  function parseCard(str) {
    if (typeof str !== 'string' || str.length !== 2) throw new Error('Ungültige Karte: ' + str);
    const r = RANKS.indexOf(str[0].toUpperCase());
    const s = SUITS.indexOf(str[1].toLowerCase());
    if (r < 0 || s < 0) throw new Error('Ungültige Karte: ' + str);
    return makeCard(r, s);
  }

  function cardToString(c) {
    return RANKS[cardRank(c)] + SUITS[cardSuit(c)];
  }

  function parseCards(str) {
    if (!str) return [];
    const clean = str.replace(/[\s,]+/g, '');
    const out = [];
    for (let i = 0; i < clean.length; i += 2) out.push(parseCard(clean.substr(i, 2)));
    return out;
  }

  // Höchste Straße in einer 13-Bit-Rangmaske; liefert Rang-Index der Höchstkarte oder -1.
  function straightHigh(mask) {
    const ext = (mask << 1) | ((mask >> 12) & 1); // Bit 0 = Ass als Eins
    for (let t = 13; t >= 4; t--) {
      if (((ext >> (t - 4)) & 31) === 31) return t - 1;
    }
    return -1;
  }

  function topBits(mask, n) {
    const out = [];
    for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
    return out;
  }

  function pack(cat, kickers) {
    let v = cat;
    for (let i = 0; i < 5; i++) v = v * 16 + (kickers[i] !== undefined ? kickers[i] + 1 : 0);
    return v;
  }

  /**
   * Bewertet 5 bis 7 Karten. Höherer Wert = bessere Hand.
   * Gibt eine Zahl zurück; Kategorie = Math.floor(score / 16^5).
   */
  function evaluate(cards) {
    const counts = new Array(13).fill(0);
    const suitMasks = [0, 0, 0, 0];
    const suitCounts = [0, 0, 0, 0];
    let mask = 0;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const r = c >> 2;
      const s = c & 3;
      counts[r]++;
      suitMasks[s] |= 1 << r;
      suitCounts[s]++;
      mask |= 1 << r;
    }

    // Flush / Straight Flush
    let flushSuit = -1;
    for (let s = 0; s < 4; s++) if (suitCounts[s] >= 5) flushSuit = s;
    if (flushSuit >= 0) {
      const sh = straightHigh(suitMasks[flushSuit]);
      if (sh >= 0) return pack(8, [sh]);
    }

    let quad = -1;
    const trips = [];
    const pairs = [];
    for (let r = 12; r >= 0; r--) {
      if (counts[r] === 4) quad = r;
      else if (counts[r] === 3) trips.push(r);
      else if (counts[r] === 2) pairs.push(r);
    }

    if (quad >= 0) {
      const kick = topBits(mask & ~(1 << quad), 1);
      return pack(7, [quad, kick[0]]);
    }
    if (trips.length > 0 && (trips.length > 1 || pairs.length > 0)) {
      const pairRank = trips.length > 1 ? Math.max(trips[1], pairs[0] !== undefined ? pairs[0] : -1) : pairs[0];
      return pack(6, [trips[0], pairRank]);
    }
    if (flushSuit >= 0) return pack(5, topBits(suitMasks[flushSuit], 5));

    const sh = straightHigh(mask);
    if (sh >= 0) return pack(4, [sh]);

    if (trips.length > 0) {
      const k = topBits(mask & ~(1 << trips[0]), 2);
      return pack(3, [trips[0], k[0], k[1]]);
    }
    if (pairs.length >= 2) {
      const k = topBits(mask & ~(1 << pairs[0]) & ~(1 << pairs[1]), 1);
      return pack(2, [pairs[0], pairs[1], k[0]]);
    }
    if (pairs.length === 1) {
      const k = topBits(mask & ~(1 << pairs[0]), 3);
      return pack(1, [pairs[0], k[0], k[1], k[2]]);
    }
    return pack(0, topBits(mask, 5));
  }

  const CAT_DIV = Math.pow(16, 5);
  const scoreCategory = (score) => Math.floor(score / CAT_DIV);

  function kickersOf(score) {
    const out = [];
    let v = score % CAT_DIV;
    for (let i = 0; i < 5; i++) {
      out.unshift((v % 16) - 1);
      v = Math.floor(v / 16);
    }
    return out;
  }

  /** Deutsche Beschreibung der Hand, z. B. "Zwei Paare: Asse und Achten". */
  function describe(score) {
    const cat = scoreCategory(score);
    const k = kickersOf(score);
    switch (cat) {
      case 8:
        return k[0] === 12 ? 'Royal Flush' : 'Straight Flush bis ' + RANK_NAMES_DE[k[0]];
      case 7:
        return 'Vierling ' + RANK_PLURAL_DE[k[0]];
      case 6:
        return 'Full House: ' + RANK_PLURAL_DE[k[0]] + ' über ' + RANK_PLURAL_DE[k[1]];
      case 5:
        return 'Flush, ' + RANK_NAMES_DE[k[0]] + '-hoch';
      case 4:
        return 'Straße bis ' + RANK_NAMES_DE[k[0]];
      case 3:
        return 'Drilling ' + RANK_PLURAL_DE[k[0]];
      case 2:
        return 'Zwei Paare: ' + RANK_PLURAL_DE[k[0]] + ' und ' + RANK_PLURAL_DE[k[1]];
      case 1:
        return 'Ein Paar ' + RANK_PLURAL_DE[k[0]];
      default:
        return 'High Card ' + RANK_NAMES_DE[k[0]];
    }
  }

  // ---------- Starthände (169 Klassen) ----------

  /** Klassenname einer Starthand, z. B. "AKs", "T9o", "QQ". */
  function handClass(c1, c2) {
    let r1 = cardRank(c1);
    let r2 = cardRank(c2);
    if (r1 < r2) [r1, r2] = [r2, r1];
    if (r1 === r2) return RANKS[r1] + RANKS[r2];
    return RANKS[r1] + RANKS[r2] + (cardSuit(c1) === cardSuit(c2) ? 's' : 'o');
  }

  function allHandClasses() {
    const out = [];
    for (let i = 12; i >= 0; i--) {
      for (let j = 12; j >= 0; j--) {
        if (i === j) out.push(RANKS[i] + RANKS[j]);
        else if (i > j) out.push(RANKS[i] + RANKS[j] + 's');
        else out.push(RANKS[j] + RANKS[i] + 'o');
      }
    }
    return out;
  }

  const comboCount = (cls) => (cls.length === 2 ? 6 : cls[2] === 's' ? 4 : 12);

  /**
   * Reihenfolge der 169 Starthände nach Stärke (stärkste zuerst).
   * Wird aus PREFLOP_RANKING (preflop-data.js) gelesen, sonst Fallback-Heuristik.
   */
  function getRanking() {
    if (root.PREFLOP_RANKING && root.PREFLOP_RANKING.length === 169) return root.PREFLOP_RANKING.map((x) => x[0]);
    // Fallback: einfache Chen-ähnliche Sortierung
    return allHandClasses().sort((a, b) => chen(b) - chen(a));
  }

  function chen(cls) {
    const vals = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 10];
    const r1 = RANKS.indexOf(cls[0]);
    const r2 = RANKS.indexOf(cls[1]);
    let s = vals[r1];
    if (r1 === r2) return Math.max(5, s * 2);
    if (cls[2] === 's') s += 2;
    const gap = r1 - r2 - 1;
    s -= [0, 1, 2, 4, 5, 5, 5, 5, 5, 5, 5, 5][gap] || 5;
    if (gap <= 1 && r1 < 10) s += 1;
    return s;
  }

  let _rankCache = null;
  function rankInfo() {
    if (_rankCache) return _rankCache;
    const order = getRanking();
    const pos = {};
    const pct = {};
    let cum = 0;
    order.forEach((cls, i) => {
      pos[cls] = i;
      cum += comboCount(cls);
      pct[cls] = cum / 1326; // Anteil aller Kombos bis einschließlich dieser Hand
    });
    _rankCache = { order, pos, pct };
    return _rankCache;
  }

  /** Perzentil einer Starthand (0 = beste, 1 = schlechteste). */
  function handPercentile(cls) {
    return rankInfo().pct[cls];
  }

  /** Set der Handklassen, die zu den besten `percent` (0..100) gehören. */
  function topRange(percent) {
    const { order, pct } = rankInfo();
    const set = new Set();
    if (percent >= 100) {
      order.forEach((c) => set.add(c));
      return set;
    }
    const lim = percent / 100;
    for (const cls of order) {
      set.add(cls);
      if (pct[cls] >= lim) break;
    }
    return set;
  }

  // ---------- Zufall ----------
  function makeRng(seed) {
    if (seed === undefined) return Math.random;
    let s = seed >>> 0 || 1;
    return function () {
      // mulberry32
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Prüft, ob die Gegnerhand (a, b) zum Board passt:
   * 0 = nichts, 1 = Draw, 2 = gemachte Hand (Paar+ mit eigener Karte), 3 = starke Hand (Zwei Paare+).
   */
  function boardConnection(a, b, board) {
    const all = board.concat([a, b]);
    const cat = scoreCategory(evaluate(all));
    const bCat = scoreCategory(evaluate(board));
    if (cat > bCat) {
      if (cat >= 2) return 3;
      return 2;
    }
    if (board.length >= 5) return 0;
    // Flush-Draw mit eigener Karte
    const sc = [0, 0, 0, 0];
    for (let i = 0; i < all.length; i++) sc[all[i] & 3]++;
    if ((sc[a & 3] === 4) || (sc[b & 3] === 4)) return 1;
    // Straßen-Draw (Open-Ender) mit eigener Karte
    let mask = 0;
    let bmask = 0;
    for (let i = 0; i < board.length; i++) bmask |= 1 << (board[i] >> 2);
    mask = bmask | (1 << (a >> 2)) | (1 << (b >> 2));
    let completing = 0;
    for (let r = 0; r < 13; r++) {
      if (mask & (1 << r)) continue;
      const sh = straightHigh(mask | (1 << r));
      if (sh >= 0 && straightHigh(bmask | (1 << r)) !== sh) completing++;
    }
    return completing >= 2 ? 1 : 0;
  }

  /**
   * Equity-Berechnung per Monte Carlo.
   * opts:
   *   hero: [c1, c2]
   *   board: [0..5 Karten]
   *   dead: tote/bekannte Karten (z. B. gefoldete, aufgedeckte)
   *   opponents: Array von { cards?: [c1,c2], range?: Set<string> | null,
   *              postflop?: { need: 1|2|3, bluff: 0..1 } }
   *     postflop: Gegner hat auf dem aktuellen Board gesetzt/erhöht. Hände mit
   *     Verbindung >= need werden immer behalten, alle anderen nur mit
   *     Wahrscheinlichkeit `bluff` (Bluff-Anteil des Spielertyps).
   *   iterations: Anzahl Simulationen
   * Liefert { win, tie, lose, equity, iterations, handDistribution }
   */
  function equity(opts) {
    const hero = opts.hero;
    const board = opts.board || [];
    const dead = opts.dead || [];
    const opponents = opts.opponents || [{}];
    const iterations = opts.iterations || 20000;
    const rng = makeRng(opts.seed);

    const used = new Uint8Array(52);
    const mark = (c) => {
      if (used[c]) throw new Error('Karte doppelt vergeben: ' + cardToString(c));
      used[c] = 1;
    };
    hero.forEach(mark);
    board.forEach(mark);
    dead.forEach(mark);
    opponents.forEach((o) => o.cards && o.cards.forEach(mark));

    const baseDeck = [];
    for (let c = 0; c < 52; c++) if (!used[c]) baseDeck.push(c);

    let win = 0;
    let tie = 0;
    let equitySum = 0;
    let done = 0;
    const heroCats = new Array(9).fill(0);

    const deck = baseDeck.slice();
    const taken = new Uint8Array(52);
    const fullBoard = new Array(5);
    const heroCards = new Array(7);
    const oppCards = new Array(7);
    const oppHands = opponents.map(() => [0, 0]);

    for (let it = 0; it < iterations; it++) {
      taken.fill(0);
      let ok = true;

      // Gegnerhände ziehen
      for (let o = 0; o < opponents.length; o++) {
        const opp = opponents[o];
        if (opp.cards) {
          oppHands[o][0] = opp.cards[0];
          oppHands[o][1] = opp.cards[1];
          continue;
        }
        let tries = 0;
        let found = false;
        const pf = opp.postflop && board.length >= 3 ? opp.postflop : null;
        while (tries++ < 3000) {
          const a = deck[Math.floor(rng() * deck.length)];
          const b = deck[Math.floor(rng() * deck.length)];
          if (a === b || taken[a] || taken[b]) continue;
          if (opp.range && !opp.range.has(handClass(a, b))) continue;
          if (pf && boardConnection(a, b, board) < pf.need && rng() >= pf.bluff) continue;
          oppHands[o][0] = a;
          oppHands[o][1] = b;
          taken[a] = 1;
          taken[b] = 1;
          found = true;
          break;
        }
        if (!found) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      // Board auffüllen
      for (let i = 0; i < board.length; i++) fullBoard[i] = board[i];
      let filled = board.length;
      while (filled < 5) {
        const c = deck[Math.floor(rng() * deck.length)];
        if (taken[c]) continue;
        taken[c] = 1;
        fullBoard[filled++] = c;
      }

      for (let i = 0; i < 5; i++) {
        heroCards[i] = fullBoard[i];
        oppCards[i] = fullBoard[i];
      }
      heroCards[5] = hero[0];
      heroCards[6] = hero[1];
      const hs = evaluate(heroCards);
      heroCats[scoreCategory(hs)]++;

      let best = true;
      let ties = 0;
      for (let o = 0; o < opponents.length; o++) {
        oppCards[5] = oppHands[o][0];
        oppCards[6] = oppHands[o][1];
        const os = evaluate(oppCards);
        if (os > hs) {
          best = false;
          break;
        }
        if (os === hs) ties++;
      }
      done++;
      if (best) {
        if (ties === 0) {
          win++;
          equitySum += 1;
        } else {
          tie++;
          equitySum += 1 / (ties + 1);
        }
      }
    }

    if (done === 0) return { win: 0, tie: 0, lose: 0, equity: 0, iterations: 0, handDistribution: heroCats };
    return {
      win: win / done,
      tie: tie / done,
      lose: (done - win - tie) / done,
      equity: equitySum / done,
      iterations: done,
      handDistribution: heroCats.map((x) => x / done),
    };
  }

  /**
   * Outs: Karten, die die Hand des Spielers auf der nächsten Straße in eine
   * höhere Kategorie bringen, wobei die Verbesserung von den eigenen Karten
   * kommt (nicht nur vom Board, das dann alle teilen).
   */
  function outs(hero, board, dead) {
    dead = dead || [];
    if (board.length < 3 || board.length > 4) return { outs: [], byCategory: {}, unseen: 0 };
    const used = new Set([...hero, ...board, ...dead]);
    const current = evaluate([...hero, ...board]);
    const curCat = scoreCategory(current);
    const list = [];
    const byCategory = {};
    let unseen = 0;
    for (let c = 0; c < 52; c++) {
      if (used.has(c)) continue;
      unseen++;
      const nb = [...board, c];
      const ns = evaluate([...hero, ...nb]);
      const nCat = scoreCategory(ns);
      if (nCat <= curCat) continue;
      // Board allein darf nicht schon gleich stark sein
      if (scoreCategory(evaluate(nb)) >= nCat) continue;
      // Paar nur aufs Board gepaart zählt nicht als echte Verbesserung
      if (nCat === 2 && curCat === 1 && !hero.some((h) => cardRank(h) === cardRank(c))) {
        // Zwei Paare durch Board-Paar sind meist wertlos
        continue;
      }
      list.push(c);
      const name = CATEGORY_NAMES[nCat];
      (byCategory[name] = byCategory[name] || []).push(c);
    }
    return { outs: list, byCategory, unseen, currentCategory: curCat };
  }

  /** Wahrscheinlichkeit, mit n Outs bis zum River zu treffen (exakt). */
  function hitProbability(nOuts, unseen, cardsToCome) {
    if (nOuts <= 0) return 0;
    if (cardsToCome === 1) return nOuts / unseen;
    // 2 Karten: 1 - P(beide verfehlen)
    return 1 - ((unseen - nOuts) / unseen) * ((unseen - nOuts - 1) / (unseen - 1));
  }

  /** Draw-Erkennung (Flush-Draw, Straßen-Draws) auf Flop/Turn. */
  function draws(hero, board) {
    const res = [];
    if (board.length < 3 || board.length > 4) return res;
    const all = [...hero, ...board];
    const suitCounts = [0, 0, 0, 0];
    const heroSuits = [0, 0, 0, 0];
    all.forEach((c) => suitCounts[cardSuit(c)]++);
    hero.forEach((c) => heroSuits[cardSuit(c)]++);
    for (let s = 0; s < 4; s++) {
      if (suitCounts[s] === 4 && heroSuits[s] > 0) {
        const nut = hero.some((c) => cardSuit(c) === s && cardRank(c) === 12);
        res.push(nut ? 'Nut-Flush-Draw' : 'Flush-Draw');
      }
    }
    if (straightHigh(all.reduce((m, c) => m | (1 << cardRank(c)), 0)) >= 0) return res;
    // Straßen-Outs zählen (Ränge, die eine Straße vervollständigen)
    let mask = 0;
    all.forEach((c) => (mask |= 1 << cardRank(c)));
    let completing = 0;
    for (let r = 0; r < 13; r++) {
      if (mask & (1 << r)) continue;
      const nm = mask | (1 << r);
      const sh = straightHigh(nm);
      if (sh < 0) continue;
      // muss eigene Karte nutzen
      const boardMask = board.reduce((m, c) => m | (1 << cardRank(c)), 0) | (1 << r);
      if (straightHigh(boardMask) === sh) continue;
      completing++;
    }
    if (completing >= 2) res.push('Open-Ended Straight Draw (8 Outs)');
    else if (completing === 1) res.push('Gutshot (4 Outs)');
    return res;
  }

  /** Beschreibung der Board-Textur. */
  function boardTexture(board) {
    if (board.length < 3) return [];
    const out = [];
    const suitCounts = [0, 0, 0, 0];
    const rankCounts = new Array(13).fill(0);
    board.forEach((c) => {
      suitCounts[cardSuit(c)]++;
      rankCounts[cardRank(c)]++;
    });
    const maxSuit = Math.max(...suitCounts);
    if (maxSuit >= 3) out.push(maxSuit >= 4 ? 'Vier einer Farbe – Flush sehr wahrscheinlich' : 'Monoton/3 einer Farbe – Flush möglich');
    else if (maxSuit === 2 && board.length === 3) out.push('Zwei-Farben-Flop (Flush-Draws möglich)');
    else if (maxSuit === 1 && board.length === 3) out.push('Rainbow (keine Flush-Draws)');
    if (Math.max(...rankCounts) >= 2) out.push('Gepaartes Board – Full House/Drilling möglich');
    const mask = board.reduce((m, c) => m | (1 << cardRank(c)), 0);
    // Straßengefahr: wie viele Ränge vervollständigen mit 2 Karten eine Straße
    let connected = 0;
    for (let lo = -1; lo <= 8; lo++) {
      let cnt = 0;
      for (let r = lo; r < lo + 5; r++) {
        const rr = r === -1 ? 12 : r;
        if (mask & (1 << rr)) cnt++;
      }
      connected = Math.max(connected, cnt);
    }
    if (connected >= 4) out.push('Sehr verbunden – Straße mit einer Karte möglich');
    else if (connected === 3) out.push('Verbunden – Straße möglich');
    const high = Math.max(...board.map(cardRank));
    if (high <= 6) out.push('Niedriges Board');
    else if (high >= 10 && board.filter((c) => cardRank(c) >= 9).length >= 2) out.push('Hohes Board (gut für Raiser-Range)');
    return out;
  }

  const api = {
    RANKS,
    SUITS,
    SUIT_SYMBOLS,
    CATEGORY_NAMES,
    RANK_NAMES_DE,
    cardRank,
    cardSuit,
    makeCard,
    parseCard,
    parseCards,
    cardToString,
    evaluate,
    scoreCategory,
    describe,
    handClass,
    allHandClasses,
    comboCount,
    handPercentile,
    topRange,
    rankInfo,
    equity,
    outs,
    hitProbability,
    draws,
    boardTexture,
    boardConnection,
    straightHigh,
    makeRng,
    _resetRankCache: () => (_rankCache = null),
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
