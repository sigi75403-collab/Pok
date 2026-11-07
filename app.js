/* Poker Hand-Analyse – Oberfläche & Empfehlungslogik */
(function () {
  'use strict';
  const E = window.PokerEngine;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  // ---------------- Konstanten ----------------
  const ALL_POS = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  const OPEN_RANGE = { UTG: 12, 'UTG+1': 14, 'UTG+2': 16, LJ: 18, HJ: 22, CO: 28, BTN: 42, SB: 38, 'BTN/SB': 60, BB: 100 };
  // Näherung an Nash-Push-Ranges (first in) bei 10 BB, nach Anzahl Spieler hinter dir
  const PUSH_BASE_10BB = { 1: 58, 2: 38, 3: 28, 4: 22, 5: 18, 6: 15, 7: 13, 8: 12 };

  const TYPES = {
    unknown: { name: 'Unbekannt', vpip: 25, pfr: 15, threeb: 6, shove: 12, aggro: false, bluff: 0.25,
      desc: 'Keine Infos – Standardannahmen eines durchschnittlichen Turnierspielers.' },
    rock: { name: 'Tight-passiv (Rock)', vpip: 12, pfr: 7, threeb: 3, shove: 6, aggro: false, bluff: 0.05,
      desc: 'Spielt wenige Hände und setzt nur mit starken Karten. Blufft selten – Einsätze ernst nehmen, gegen ihn öfter folden, aber oft stehlen.' },
    tag: { name: 'Tight-aggressiv (TAG)', vpip: 20, pfr: 16, threeb: 7, shove: 10, aggro: true, bluff: 0.25,
      desc: 'Solider Reg: selektiv, aber aggressiv. Raises bedeuten meist eine echte Hand, Continuation Bets sind breiter.' },
    station: { name: 'Loose-passiv (Calling Station)', vpip: 45, pfr: 7, threeb: 3, shove: 8, aggro: false, bluff: 0.10,
      desc: 'Callt zu viel, raist selten. Nicht bluffen – stattdessen dünn auf Value setzen. Raise von ihm = sehr stark.' },
    lag: { name: 'Loose-aggressiv (LAG)', vpip: 35, pfr: 27, threeb: 12, shove: 20, aggro: true, bluff: 0.45,
      desc: 'Viele Hände, viel Druck. Blufft regelmäßig – öfter mit mittleren Händen callen (Bluff-Catcher), Fallen stellen.' },
    maniac: { name: 'Maniac / Dauer-Bluffer', vpip: 60, pfr: 45, threeb: 25, shove: 40, aggro: true, bluff: 0.75,
      desc: 'Setzt mit fast allem. Gute Hände nicht verstecken, sondern ihn bluffen lassen und callen.' },
  };

  const ACTIONS = {
    blind: { name: 'Nur Blind / Check', key: null },
    call: { name: 'Limp / Call', key: 'vpip' },
    raise: { name: 'Raise / Open', key: 'pfr' },
    threebet: { name: '3-Bet / Re-Raise', key: 'threeb' },
    allin: { name: 'All-in', key: 'shove' },
  };
  const POST = {
    none: { name: '– / Check / Call', need: 0, bluffF: 1 },
    bet: { name: 'Bet', need: 1, bluffF: 1 },
    raise: { name: 'Raise / Check-Raise', need: 3, bluffF: 0.6 },
  };

  const STORE_KEY = 'pha.current.v1';
  const HIST_KEY = 'pha.history.v1';
  const SETTINGS_KEY = 'pha.settings.v1';

  // ---------------- Zustand ----------------
  function newOpponent() {
    return { type: 'unknown', action: 'call', post: 'none', range: 25, manual: false, cards: [null, null], showCards: false };
  }

  function freshState(settings) {
    const s = settings || {};
    return {
      hero: [null, null],
      board: [null, null, null, null, null],
      dead: [],
      sb: s.sb ?? 50,
      bb: s.bb ?? 100,
      ante: s.ante ?? 12,
      players: s.players ?? 9,
      position: s.position ?? 'BTN',
      stack: s.stack ?? 10000,
      pot: 0,
      toCall: 0,
      oppStack: '',
      opponents: [newOpponent()],
      heroAction: '',
      note: '',
      editingId: null,
    };
  }

  const load = (k, d) => {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch (e) {
      return d;
    }
  };
  const save = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { /* privat-Modus o. Ä. */ }
  };

  let state = load(STORE_KEY, null) || freshState(load(SETTINGS_KEY, null));
  let history = load(HIST_KEY, []);
  let active = { group: 'hero', idx: 0 };
  let lastAnalysis = null;

  // Grundwerte für den Pot: Blinds + Antes, falls noch nicht gesetzt
  function defaultPot() {
    return num(state.sb) + num(state.bb) + num(state.ante) * num(state.players);
  }
  if (!state.pot) state.pot = defaultPot();

  function num(v) {
    const n = parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  const fmt = (n, d = 0) => (isFinite(n) ? n.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d }) : '–');
  const pct = (x, d = 1) => fmt(x * 100, d) + ' %';
  const bbs = (chips) => (num(state.bb) > 0 ? fmt(chips / num(state.bb), 1) + ' BB' : fmt(chips));
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // ---------------- Karten-Darstellung ----------------
  function cardHTML(c, cls = 'pcard') {
    if (c === null || c === undefined) return '';
    const r = E.RANKS[E.cardRank(c)];
    const s = E.SUITS[E.cardSuit(c)];
    const rank = r === 'T' ? '10' : r;
    if (cls === 'mini') return `<span class="mini suit-${s}">${rank}${E.SUIT_SYMBOLS[s]}</span>`;
    return `<div class="${cls} suit-${s}"><span class="r">${rank}</span><span class="s">${E.SUIT_SYMBOLS[s]}</span></div>`;
  }
  const miniCards = (arr) => arr.filter((c) => c !== null && c !== undefined).map((c) => cardHTML(c, 'mini')).join('');

  function usedCards() {
    const u = new Set();
    state.hero.forEach((c) => c !== null && u.add(c));
    state.board.forEach((c) => c !== null && u.add(c));
    state.dead.forEach((c) => c !== null && u.add(c));
    state.opponents.forEach((o) => o.showCards && o.cards.forEach((c) => c !== null && u.add(c)));
    return u;
  }

  function slotArray(group, opp) {
    if (group === 'hero') return state.hero;
    if (group === 'board') return state.board;
    if (group === 'dead') return state.dead;
    if (group === 'opp') return state.opponents[opp].cards;
    return [];
  }

  function isActive(group, idx, opp) {
    return active && active.group === group && active.idx === idx && (group !== 'opp' || active.opp === opp);
  }

  function slotHTML(group, idx, c, opp, extraCls = '') {
    const act = isActive(group, idx, opp) ? ' active' : '';
    const label = c === null || c === undefined ? (group === 'board' ? ['Flop', 'Flop', 'Flop', 'Turn', 'River'][idx] : '+') : '';
    return `<button class="slot${act} ${extraCls}" data-group="${group}" data-idx="${idx}"${opp !== undefined ? ` data-opp="${opp}"` : ''}>${
      c === null || c === undefined ? label : cardHTML(c)
    }</button>`;
  }

  function renderSlots() {
    $('.slots[data-group=hero]').innerHTML = state.hero.map((c, i) => slotHTML('hero', i, c)).join('');
    $('.slots[data-group=board]').innerHTML = state.board.map((c, i) => slotHTML('board', i, c, undefined, i === 3 || i === 4 ? 'gap' : '')).join('');
    const dead = state.dead.slice();
    $('.slots[data-group=dead]').innerHTML = dead.map((c, i) => slotHTML('dead', i, c)).join('') + slotHTML('dead', dead.length, null);
    const st = streetName();
    $('#streetLabel').textContent = st;
  }

  function renderPicker() {
    const used = usedCards();
    let html = '';
    for (let s = 0; s < 4; s++) {
      for (let r = 12; r >= 0; r--) {
        const c = E.makeCard(r, s);
        const sc = E.SUITS[s];
        const rank = E.RANKS[r] === 'T' ? '10' : E.RANKS[r];
        html += `<button class="pick suit-${sc}" data-card="${c}" ${used.has(c) ? 'disabled' : ''}><span>${rank}</span><span>${E.SUIT_SYMBOLS[sc]}</span></button>`;
      }
    }
    $('#picker').innerHTML = html;
  }

  function streetName() {
    const n = state.board.filter((c) => c !== null).length;
    return n === 0 ? 'Preflop' : n <= 3 ? 'Flop' : n === 4 ? 'Turn' : 'River';
  }

  // Nächstes freies Feld automatisch aktivieren
  function advanceActive() {
    const order = [
      ...state.hero.map((_, i) => ({ group: 'hero', idx: i })),
      ...state.board.map((_, i) => ({ group: 'board', idx: i })),
    ];
    const start = active ? order.findIndex((o) => o.group === active.group && o.idx === active.idx) : -1;
    if (active && active.group === 'dead') {
      active = { group: 'dead', idx: state.dead.length };
      return;
    }
    if (active && active.group === 'opp') {
      const cards = state.opponents[active.opp].cards;
      const free = cards.findIndex((c) => c === null);
      active = free >= 0 ? { group: 'opp', idx: free, opp: active.opp } : null;
      return;
    }
    for (let k = start + 1; k < order.length; k++) {
      if (slotArray(order[k].group)[order[k].idx] === null) {
        // Board nur der Reihe nach füllen: Turn erst nach vollständigem Flop vorschlagen
        active = order[k];
        return;
      }
    }
    active = null;
  }

  function onSlotTap(el) {
    const group = el.dataset.group;
    const idx = +el.dataset.idx;
    const opp = el.dataset.opp !== undefined ? +el.dataset.opp : undefined;
    const arr = slotArray(group, opp);
    if (arr[idx] !== null && arr[idx] !== undefined) {
      // Karte entfernen
      if (group === 'dead') arr.splice(idx, 1);
      else arr[idx] = null;
      active = { group, idx: group === 'dead' ? state.dead.length : idx, opp };
    } else {
      active = isActive(group, idx, opp) ? null : { group, idx, opp };
    }
    changed(true);
  }

  function onPick(card) {
    if (!active) {
      // Kein Feld aktiv → erstes freies Feld wählen
      active = { group: 'hero', idx: -1 };
      advanceActive();
      if (!active) return toast('Alle Felder belegt – Feld antippen zum Ändern');
    }
    const arr = slotArray(active.group, active.opp);
    if (active.group === 'dead') arr.push(card);
    else arr[active.idx] = card;
    advanceActive();
    changed(true);
  }

  // ---------------- Formular ----------------
  function positionsFor(n) {
    if (n <= 2) return ['BTN/SB', 'BB'];
    return ALL_POS.slice(9 - n);
  }

  function renderForm() {
    $('#sb').value = state.sb;
    $('#bb').value = state.bb;
    $('#ante').value = state.ante;
    $('#stack').value = state.stack;
    $('#pot').value = state.pot;
    $('#toCall').value = state.toCall;
    $('#oppStack').value = state.oppStack;
    $('#note').value = state.note;
    const pSel = $('#players');
    pSel.innerHTML = [2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}" ${n === +state.players ? 'selected' : ''}>${n}${n === 2 ? ' (Heads-up)' : ''}</option>`).join('');
    const positions = positionsFor(+state.players);
    if (!positions.includes(state.position)) state.position = positions[positions.length - 3] || positions[0];
    $('#position').innerHTML = positions.map((p) => `<option ${p === state.position ? 'selected' : ''}>${p}</option>`).join('');
    $$('#heroActions .chip').forEach((b) => b.classList.toggle('active', b.dataset.act === state.heroAction));
    renderOpponents();
  }

  function oppRange(o) {
    if (o.manual) return o.range;
    const t = TYPES[o.type];
    const a = ACTIONS[o.action];
    const r = a.key ? t[a.key] : 100;
    return Math.max(1, Math.min(100, Math.round(r)));
  }

  function renderOpponents() {
    $('#oppCount').textContent = state.opponents.length;
    $('#opponents').innerHTML = state.opponents
      .map((o, i) => {
        const range = oppRange(o);
        o.range = range;
        return `<div class="opp" data-opp="${i}">
        <div class="opp-head"><span>Gegner ${i + 1}</span>
          <label class="inline small"><input type="checkbox" data-f="showCards" ${o.showCards ? 'checked' : ''}> Karten bekannt</label></div>
        <div class="grid3">
          <label>Spielertyp<select data-f="type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${k === o.type ? 'selected' : ''}>${t.name}</option>`).join('')}</select></label>
          <label>Aktion preflop<select data-f="action">${Object.entries(ACTIONS).map(([k, a]) => `<option value="${k}" ${k === o.action ? 'selected' : ''}>${a.name}</option>`).join('')}</select></label>
        </div>
        <label>Aktion auf dieser Straße (postflop)<select data-f="post">${Object.entries(POST).map(([k, a]) => `<option value="${k}" ${k === o.post ? 'selected' : ''}>${a.name}</option>`).join('')}</select></label>
        ${
          o.showCards
            ? `<div class="knowncards">Karten: ${o.cards.map((c, j) => slotHTML('opp', j, c, i)).join('')}</div>`
            : `<div class="range-line">Range: Top <input type="range" min="1" max="100" value="${range}" data-f="range"> <b>${range} %</b>
               ${o.manual ? '<button class="btn small ghost" data-f="auto">Auto</button>' : ''}</div>`
        }
      </div>`;
      })
      .join('');
  }

  function readForm() {
    ['sb', 'bb', 'ante', 'stack', 'pot', 'toCall'].forEach((k) => (state[k] = num($('#' + k).value)));
    state.oppStack = $('#oppStack').value === '' ? '' : num($('#oppStack').value);
    state.players = +$('#players').value;
    state.position = $('#position').value;
    state.note = $('#note').value;
    save(SETTINGS_KEY, { sb: state.sb, bb: state.bb, ante: state.ante, players: state.players, position: state.position, stack: state.stack });
  }

  // ---------------- Analyse ----------------
  function stackZone(m) {
    if (m >= 20) return ['green', 'Grüne Zone – volles Spiel'];
    if (m >= 10) return ['yellow', 'Gelbe Zone – weniger spekulieren'];
    if (m >= 6) return ['orange', 'Orange Zone – Push/Fold vorbereiten'];
    if (m >= 1) return ['red', 'Rote Zone – Push oder Fold'];
    return ['dead', 'Tote Zone – jeder Push zählt'];
  }

  function playersBehind() {
    const list = positionsFor(+state.players);
    const i = list.indexOf(state.position);
    return Math.max(0, list.length - 1 - i);
  }

  function pushPercent(bbCount, behind) {
    if (behind <= 0) return 0;
    const base = PUSH_BASE_10BB[Math.min(8, behind)];
    return Math.min(100, base * Math.pow(10 / Math.max(1, bbCount), 0.8));
  }

  function analyse() {
    const hero = state.hero.filter((c) => c !== null);
    if (hero.length < 2) return null;
    const board = state.board.filter((c) => c !== null);
    if (board.length === 1 || board.length === 2) return { error: 'Für den Flop bitte alle drei Karten eintragen.' };
    const dead = state.dead.slice();

    const opps = state.opponents.map((o) => {
      if (o.showCards) {
        const cs = o.cards.filter((c) => c !== null);
        if (cs.length === 2) return { cards: cs, label: 'bekannte Karten' };
        if (cs.length === 1) dead.push(cs[0]);
      }
      const r = oppRange(o);
      const p = POST[o.post] || POST.none;
      const bluff = TYPES[o.type].bluff * p.bluffF;
      const postflop = board.length >= 3 && p.need > 0 ? { need: p.need, bluff } : null;
      const label = `Top ${r} %` + (postflop ? ` · ${p.name}, Bluff-Anteil ≈ ${Math.round(bluff * 100)} %` : '');
      return { range: r >= 100 ? null : E.topRange(r), postflop, label, pct: r };
    });

    const bb = num(state.bb) || 1;
    const stack = num(state.stack);
    const pot = num(state.pot);
    const toCall = Math.min(num(state.toCall), stack || Infinity);
    const oppStack = state.oppStack === '' ? Infinity : num(state.oppStack);
    const effStack = Math.min(stack, oppStack);
    const n = opps.length;

    const iterations = n <= 2 ? 12000 : n <= 4 ? 8000 : 5000;
    let eq;
    try {
      eq = E.equity({ hero, board, dead, opponents: opps, iterations });
    } catch (e) {
      return { error: e.message };
    }

    const score = board.length >= 3 ? E.evaluate([...hero, ...board]) : null;
    const cls = E.handClass(hero[0], hero[1]);
    const percentile = E.handPercentile(cls);
    const outs = board.length >= 3 && board.length <= 4 ? E.outs(hero, board, dead) : null;
    const draws = E.draws(hero, board);
    const texture = E.boardTexture(board);

    const reqEq = toCall > 0 ? toCall / (pot + toCall) : 0;
    const callEV = toCall > 0 ? eq.equity * (pot + toCall) - toCall : 0;
    const spr = pot > 0 ? effStack / pot : Infinity;
    const orbit = num(state.sb) + num(state.bb) + num(state.ante) * num(state.players);
    const mRatio = orbit > 0 ? stack / orbit : Infinity;
    const bbCount = stack / bb;

    const res = {
      hero, board, cls, percentile, eq, score, outs, draws, texture, reqEq, callEV, toCall, pot,
      spr, mRatio, bbCount, effStack, n, opps, street: streetName(),
    };
    res.rec = recommend(res);
    res.verdict = judge(res);
    return res;
  }

  function recommend(a) {
    const bb = num(state.bb) || 1;
    const why = [];
    const n = a.n;
    const e = a.eq.equity;
    const fair = 1 / (n + 1);
    const valueTh = Math.min(0.62, 1.45 / (n + 1));
    const types = state.opponents.map((o) => TYPES[o.type]);
    const allAggro = types.every((t) => t.aggro);
    const anyStation = state.opponents.some((o) => o.type === 'station');
    const allTight = state.opponents.every((o) => o.type === 'rock' || o.type === 'tag');
    const cardsToCome = a.board.length === 0 ? 5 : 5 - a.board.length;
    const preflop = a.board.length === 0;
    const facingRaise = a.toCall > bb * 1.01;

    // ---- Preflop: Push/Fold bei kurzem Stack ----
    if (preflop && a.bbCount <= 15 && !facingRaise && state.position !== 'BB') {
      const behind = playersBehind();
      const pp = pushPercent(a.bbCount, behind);
      const inRange = a.percentile * 100 <= pp + 0.001;
      why.push(`Stack ${fmt(a.bbCount, 1)} BB → Push/Fold-Bereich (kein Platz für Raise-Fold).`);
      why.push(`Push-Range aus ${state.position} mit ${behind} Spieler(n) hinter dir: ca. Top ${fmt(pp, 0)} %.`);
      why.push(`${a.cls} gehört zu den Top ${fmt(a.percentile * 100, 1)} % aller Starthände.`);
      if (inRange) return { action: 'allin', label: 'ALL-IN', tone: 'good', why };
      if (a.percentile * 100 <= pp * 1.25) {
        why.push('Knapp außerhalb – gegen sehr tighte Gegner hinter dir trotzdem ein Push.');
        return { action: 'fold', label: 'FOLD (knapp)', tone: 'mid', why };
      }
      return { action: 'fold', label: 'FOLD', tone: 'bad', why };
    }

    // ---- Preflop: offener Pot, tiefer Stack ----
    if (preflop && !facingRaise) {
      const open = state.position === 'BB' ? 100 : OPEN_RANGE[state.position] || 20;
      const inOpen = a.percentile * 100 <= open;
      why.push(`${a.cls} gehört zu den Top ${fmt(a.percentile * 100, 1)} % aller Starthände.`);
      if (state.position === 'BB' && a.toCall <= 0.001) {
        if (a.percentile <= 0.15) {
          why.push('Gegen Limper: starke Hand → Raise auf ca. 4 BB + 1 BB pro Limper.');
          return { action: 'bet', label: 'RAISE', tone: 'good', why, size: 4 * bb };
        }
        why.push('Im Big Blind ohne Raise vor dir: kostenlos den Flop sehen.');
        return { action: 'check', label: 'CHECK', tone: 'mid', why };
      }
      why.push(`Übliche Eröffnungs-Range aus ${state.position}: ca. Top ${open} %.`);
      if (inOpen) {
        const size = a.bbCount > 40 ? 2.2 : 2;
        why.push(`Eröffnen mit ca. ${size} BB${a.toCall > 0 && a.toCall <= bb ? ' (bei Limpern +1 BB je Limper)' : ''}.`);
        return { action: 'bet', label: 'RAISE', tone: 'good', why, size: size * bb };
      }
      if (a.toCall > 0 && a.toCall <= bb && a.percentile <= open / 100 * 1.6 && /^(\w)\1$|s$/.test(a.cls) && a.bbCount > 30) {
        why.push('Paar/suited Hand: mit tiefem Stack günstig mitlimpen und auf Set/Flush spekulieren ist vertretbar.');
        return { action: 'call', label: 'CALL (Limp)', tone: 'mid', why };
      }
      return { action: 'fold', label: 'FOLD', tone: 'bad', why };
    }

    // ---- Allgemein: Equity gegen Pot Odds ----
    why.push(`Deine Equity: ${pct(e)} gegen ${n} Gegner (fairer Anteil wäre ${pct(fair, 0)}).`);
    if (a.toCall > 0) {
      why.push(`Pot Odds: ${fmt(a.toCall)} in einen Pot von ${fmt(a.pot + a.toCall)} → benötigt ${pct(a.reqEq)} Equity.`);
      why.push(`EV eines Calls (ohne spätere Straßen): ${a.callEV >= 0 ? '+' : ''}${bbs(a.callEV)}.`);
      const shortCall = a.toCall >= num(state.stack) * 0.4 || a.spr < 1.5;
      if (e >= valueTh && e >= a.reqEq) {
        why.push('Deutlich vorne → für Value erhöhen.');
        if (shortCall || a.spr < 2) return { action: 'allin', label: 'ALL-IN', tone: 'good', why };
        if (allAggro) why.push('Aggressiver Gegner: auch Call als Falle möglich, er blufft oft weiter.');
        return { action: 'bet', label: 'RAISE', tone: 'good', why, size: (a.pot + a.toCall * 2) * 0.9 };
      }
      if (e >= a.reqEq) {
        if (a.draws.length && cardsToCome > 0) why.push('Mit Draw: Call rechnet sich direkt, Implied Odds kommen dazu.');
        if (shortCall) {
          why.push('Kurzer Stack/kleiner SPR: sinnvoller All-in als Call.');
          return { action: 'allin', label: 'CALL / ALL-IN', tone: 'good', why };
        }
        return { action: 'call', label: 'CALL', tone: 'good', why };
      }
      // Equity reicht nicht
      const gap = a.reqEq - e;
      if (gap < 0.06 && a.draws.length && cardsToCome === 2 && a.effStack > a.pot * 2 && !preflop) {
        why.push(`Es fehlen ${pct(gap)} – nur mit Implied Odds (tiefe Stacks, versteckter Draw) vertretbar.`);
        if (anyStation) why.push('Gegen Calling Stations werden Implied Odds oft ausbezahlt.');
        return { action: 'call', label: 'CALL (knapp)', tone: 'mid', why };
      }
      if (gap < 0.04 && allAggro) {
        why.push('Knapp: Gegen aggressive Bluffer ist die tatsächliche Range oft breiter – Call grenzwertig.');
        return { action: 'call', label: 'CALL (grenzwertig)', tone: 'mid', why };
      }
      if (allTight) why.push('Tighter Gegner setzt selten ohne Hand – Fold umso klarer.');
      return { action: 'fold', label: 'FOLD', tone: 'bad', why };
    }

    // ---- Niemand hat gesetzt ----
    if (e >= valueTh) {
      const size = a.spr < 1.2 ? null : a.pot * (a.texture.some((t) => /Flush|Straße mit einer/.test(t)) ? 0.75 : 0.6);
      why.push('Du bist vorne → auf Value setzen' + (anyStation ? ' (gegen Calling Station ruhig größer).' : '.'));
      if (a.texture.length) why.push('Board: ' + a.texture.join(', ') + '.');
      if (!size) return { action: 'allin', label: 'ALL-IN', tone: 'good', why };
      return { action: 'bet', label: 'BET', tone: 'good', why, size };
    }
    if (e >= fair * 0.9) {
      why.push('Mittlere Stärke → Pot klein halten, günstig zum Showdown.');
      if (a.draws.length && cardsToCome > 0) why.push('Semi-Bluff mit deinem Draw ist eine Alternative.');
      return { action: 'check', label: 'CHECK', tone: 'mid', why };
    }
    if (n === 1 && allTight && a.board.length >= 3 && !anyStation) {
      why.push('Schwache Hand, aber tighter Einzelgegner: ein Bluff (ca. ½ Pot) kann ihn zum Folden bringen.');
      return { action: 'check', label: 'CHECK (oder Bluff)', tone: 'mid', why, size: a.pot * 0.5 };
    }
    if (a.draws.length && cardsToCome > 0 && !anyStation) {
      why.push('Hinten, aber mit Draw → Semi-Bluff möglich, sonst Check.');
      return { action: 'check', label: 'CHECK / SEMI-BLUFF', tone: 'mid', why, size: a.pot * 0.55 };
    }
    why.push('Hinten → Check, auf Einsatz meist folden.');
    if (anyStation) why.push('Gegen Calling Stations nicht bluffen.');
    return { action: 'check', label: 'CHECK / FOLD', tone: 'bad', why };
  }

  function judge(a) {
    const act = state.heroAction;
    if (!act) return null;
    const rec = a.rec.action;
    const bbn = num(state.bb) || 1;
    const ok = (txt) => ({ tone: 'good', text: '✓ ' + txt });
    const mid = (txt) => ({ tone: 'mid', text: '≈ ' + txt });
    const bad = (txt) => ({ tone: 'bad', text: '✗ ' + txt });
    const evbb = (v) => fmt(v / bbn, 1) + ' BB';
    const aggressive = (x) => x === 'bet' || x === 'allin';

    if (act === rec) return ok('Deine Aktion entspricht der Empfehlung.');
    if (aggressive(act) && aggressive(rec)) return ok('Aggressiv gespielt wie empfohlen (Größe weicht ab).');
    if (a.toCall > 0) {
      if (act === 'fold' && rec !== 'fold') {
        return a.callEV > 0 ? bad(`Fold war zu vorsichtig – ein Call hätte ca. +${evbb(a.callEV)} EV gebracht.`) : mid('Fold vertretbar.');
      }
      if ((act === 'call' || act === 'allin') && rec === 'fold') {
        return a.callEV < 0 ? bad(`Call war ein Verlust von ca. ${evbb(-a.callEV)} EV (Equity ${pct(a.eq.equity)} < benötigt ${pct(a.reqEq)}).`) : mid('Knapp, Call nicht falsch.');
      }
      if (act === 'call' && aggressive(rec)) return mid('Call ist profitabel, aber du hast Value verschenkt – Raise wäre besser gewesen.');
      if (aggressive(act) && rec === 'call') return mid('Raise statt Call – riskanter als nötig, aber mit Fold-Equity vertretbar.');
      if (act === 'check') return bad('Check ist hier nicht möglich (es liegt ein Einsatz).');
    } else {
      if (act === 'fold') return bad('Fold ohne Einsatz ist nie richtig – kostenlos checken!');
      if (act === 'check' && aggressive(rec)) return mid('Check mit starker Hand verschenkt Value (außer als bewusste Falle).');
      if (aggressive(act) && rec === 'check') return a.eq.equity < 0.3 ? mid('Bluff – nur sinnvoll gegen foldfreudige Gegner.') : mid('Bet mit mittlerer Hand – Gefahr, nur von besseren Händen gecallt zu werden.');
      if (act === 'call') return mid('Kein Einsatz zu callen – gemeint war wohl Check.');
    }
    return mid('Abweichung von der Empfehlung.');
  }

  // ---------------- Ergebnis-Darstellung ----------------
  function renderStackInfo() {
    const bb = num(state.bb);
    const orbit = num(state.sb) + num(state.bb) + num(state.ante) * num(state.players);
    const stack = num(state.stack);
    if (!bb || !stack) return ($('#stackInfo').innerHTML = '');
    const m = orbit > 0 ? stack / orbit : 0;
    const [zc, zt] = stackZone(m);
    $('#stackInfo').innerHTML = `<span class="tag">${fmt(stack / bb, 1)} BB</span><span class="tag">M = ${fmt(m, 1)}</span><span class="zone ${zc}">${zt}</span>`;
  }

  function renderResults() {
    const a = lastAnalysis;
    const el = $('#results');
    if (!a) return (el.innerHTML = '<div class="empty">Wähle deine zwei Karten, um die Analyse zu starten.</div>');
    if (a.error) return (el.innerHTML = `<div class="empty">${esc(a.error)}</div>`);

    const r = a.rec;
    const bb = num(state.bb) || 1;
    let html = `
      <div class="rec ${r.tone}">
        <div class="muted small">Empfehlung · ${a.street}</div>
        <div class="act">${r.label}${r.size ? ` <span class="muted" style="font-size:17px">≈ ${fmt(r.size)} (${fmt(r.size / bb, 1)} BB)</span>` : ''}</div>
        <ul>${r.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      </div>`;
    if (a.verdict) html += `<div class="verdict ${a.verdict.tone}">${esc(a.verdict.text)}</div>`;

    // Kennzahlen
    const eqW = a.eq.win * 100;
    const eqT = a.eq.tie * 100;
    html += `
      <div class="kpis">
        <div class="kpi"><div class="l">Equity</div><div class="v">${pct(a.eq.equity)}</div><div class="sub">${fmt(a.eq.iterations)} Simulationen</div></div>
        <div class="kpi"><div class="l">Benötigt (Pot Odds)</div><div class="v">${a.toCall > 0 ? pct(a.reqEq) : '–'}</div><div class="sub">${a.toCall > 0 ? 'Call-EV ' + (a.callEV >= 0 ? '+' : '') + bbs(a.callEV) : 'kein Einsatz offen'}</div></div>
        <div class="kpi"><div class="l">SPR</div><div class="v">${isFinite(a.spr) ? fmt(a.spr, 1) : '–'}</div><div class="sub">Stack-zu-Pot</div></div>
      </div>
      <div class="eqwrap">
        <div class="eqbar"><div class="w" style="width:${eqW}%"></div><div class="t" style="width:${eqT}%"></div></div>
        ${a.toCall > 0 ? `<div class="req" style="left:calc(${a.reqEq * 100}% - 1px)" title="benötigte Equity"></div>` : ''}
      </div>
      <div class="legend"><span><i style="background:var(--good)"></i>Gewinn ${pct(a.eq.win)}</span><span><i style="background:var(--warn)"></i>Split ${pct(a.eq.tie)}</span><span><i style="background:var(--line)"></i>Verlust ${pct(a.eq.lose)}</span>${a.toCall > 0 ? '<span><i style="background:#fff"></i>benötigt</span>' : ''}</div>`;

    // Hand
    html += `<div class="section-title">Deine Hand</div><div class="tags">`;
    if (a.score !== null) html += `<span class="tag hot">${esc(E.describe(a.score))}</span>`;
    html += `<span class="tag${a.score === null ? ' hot' : ''}">Starthand ${a.cls} · Top ${fmt(a.percentile * 100, 1)} %</span>`;
    a.draws.forEach((d) => (html += `<span class="tag hot">${esc(d)}</span>`));
    html += `</div>`;
    if (a.texture.length) html += `<div class="tags">${a.texture.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;

    // Gegner
    html += `<div class="section-title">Gegner-Annahmen</div><div class="tags">${a.opps
      .map((o, i) => `<span class="tag">G${i + 1}: ${TYPES[state.opponents[i].type].name.split(' (')[0]} · ${o.cards ? miniCards(o.cards) : esc(o.label)}</span>`)
      .join('')}</div>`;

    // Outs
    if (a.outs) {
      const toCome = 5 - a.board.length;
      const n = a.outs.outs.length;
      html += `<div class="section-title">Outs (${n} von ${a.outs.unseen} unbekannten Karten)</div>`;
      if (n) {
        Object.entries(a.outs.byCategory).forEach(([name, cards]) => {
          html += `<div class="outs-group"><b>${esc(name)}</b> · ${cards.length}<div class="cards">${miniCards(cards)}</div></div>`;
        });
        html += `<div class="tags"><span class="tag">Nächste Karte: ${pct(E.hitProbability(n, a.outs.unseen, 1))}</span>${
          toCome === 2 ? `<span class="tag">Bis River: ${pct(E.hitProbability(n, a.outs.unseen, 2))}</span>` : ''
        }<span class="tag">Faustregel: ${n} × ${toCome === 2 ? 4 : 2} ≈ ${Math.min(100, n * (toCome === 2 ? 4 : 2))} %</span></div>`;
        html += `<div class="muted small">Achtung: Nicht jedes Out ist „sauber“ – ein Gegner kann trotzdem besser sein. Die Equity oben berücksichtigt das bereits.</div>`;
      } else html += `<div class="muted small">Keine Verbesserungskarten in eine höhere Handkategorie.</div>`;
    }

    // Verteilung am River
    if (a.board.length < 5) {
      html += `<div class="section-title">Deine Hand am River (Wahrscheinlichkeit)</div><div class="dist">`;
      const d = a.eq.handDistribution;
      const max = Math.max(...d);
      for (let c = 8; c >= 0; c--) {
        if (d[c] < 0.0005) continue;
        html += `<span>${E.CATEGORY_NAMES[c]}</span><div class="bar" style="width:${(d[c] / max) * 100}%"></div><span class="pct">${pct(d[c])}</span>`;
      }
      html += `</div>`;
    }

    // Stack
    const [zc, zt] = stackZone(a.mRatio);
    html += `<div class="section-title">Turnier</div><div class="tags"><span class="tag">${fmt(a.bbCount, 1)} BB</span><span class="tag">M = ${fmt(a.mRatio, 1)}</span><span class="zone ${zc}">${zt}</span></div>`;

    html += `<div class="disclaimer">Lern- und Analysewerkzeug für die Nachbereitung. Gegner-Ranges sind Annahmen auf Basis des gewählten Spielertyps; die Equity ist eine Monte-Carlo-Schätzung (±1 %). Nicht während laufender Echtgeld-Hände verwenden – das verstößt gegen die Regeln der Pokerräume.</div>`;
    el.innerHTML = html;
  }

  // ---------------- Ablauf ----------------
  let timer = null;
  function changed(rerenderForm) {
    renderSlots();
    renderPicker();
    if (rerenderForm) renderOpponents();
    renderStackInfo();
    save(STORE_KEY, state);
    clearTimeout(timer);
    timer = setTimeout(() => {
      lastAnalysis = analyse();
      renderResults();
    }, 120);
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ---------------- Verlauf ----------------
  function saveHand() {
    readForm();
    if (!lastAnalysis || lastAnalysis.error) return toast('Erst Karten eingeben');
    const a = lastAnalysis;
    const entry = {
      id: state.editingId || 'h' + Date.now().toString(36),
      ts: Date.now(),
      state: JSON.parse(JSON.stringify({ ...state, editingId: null })),
      summary: {
        cls: a.cls,
        hand: a.score !== null ? E.describe(a.score) : a.cls,
        street: a.street,
        equity: a.eq.equity,
        rec: a.rec.label,
        recAction: a.rec.action,
        verdict: a.verdict,
        callEV: a.callEV,
        toCall: a.toCall,
        bb: num(state.bb),
      },
    };
    const i = history.findIndex((h) => h.id === entry.id);
    if (i >= 0) history[i] = entry;
    else history.unshift(entry);
    save(HIST_KEY, history);
    state.editingId = entry.id;
    save(STORE_KEY, state);
    renderHistory();
    toast('Hand gespeichert');
  }

  function evLoss(h) {
    const s = h.summary;
    if (!s.verdict || s.verdict.tone !== 'bad' || !s.toCall) return 0;
    return Math.abs(s.callEV) / (s.bb || 1);
  }

  function renderHistory() {
    $('#historyCount').textContent = history.length || '';
    const judged = history.filter((h) => h.summary.verdict);
    const good = judged.filter((h) => h.summary.verdict.tone === 'good').length;
    const badN = judged.filter((h) => h.summary.verdict.tone === 'bad').length;
    const loss = history.reduce((s, h) => s + evLoss(h), 0);
    $('#historyStats').innerHTML = `
      <div class="kpi"><div class="l">Hände</div><div class="v">${history.length}</div></div>
      <div class="kpi"><div class="l">Wie empfohlen</div><div class="v">${judged.length ? pct(good / judged.length, 0) : '–'}</div><div class="sub">${judged.length} bewertet</div></div>
      <div class="kpi"><div class="l">Klare Fehler</div><div class="v">${badN}</div></div>
      <div class="kpi"><div class="l">EV-Verlust (Calls/Folds)</div><div class="v">${fmt(loss, 1)}</div><div class="sub">Big Blinds</div></div>`;
    if (!history.length) return ($('#historyList').innerHTML = '<div class="empty">Noch keine Hände gespeichert.</div>');
    $('#historyList').innerHTML = history
      .map((h) => {
        const s = h.summary;
        const st = h.state;
        const d = new Date(h.ts);
        return `<div class="hitem">
          <div class="cards">${miniCards(st.hero)}<span style="width:8px"></span>${miniCards(st.board)}</div>
          <div>
            <div class="title">${esc(s.hand)} · ${esc(s.street)} · Equity ${pct(s.equity, 0)}</div>
            <div class="meta">${d.toLocaleDateString('de-DE')} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · Blinds ${fmt(st.sb)}/${fmt(st.bb)} · ${esc(st.position)} · Empfehlung: <b>${esc(s.rec)}</b>${
          s.verdict ? ` · <span class="${s.verdict.tone === 'good' ? '' : 'muted'}">${esc(s.verdict.text)}</span>` : ''
        }</div>
            ${st.note ? `<div class="meta">📝 ${esc(st.note)}</div>` : ''}
          </div>
          <div class="btns"><button class="btn small" data-load="${h.id}">Öffnen</button><button class="btn small ghost danger" data-del="${h.id}">Löschen</button></div>
        </div>`;
      })
      .join('');
  }

  function showView(v) {
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
    $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
    window.scrollTo(0, 0);
  }

  // ---------------- Wissen ----------------
  function renderKnowledge() {
    const ex = (s) => miniCards(E.parseCards(s));
    const rows = [
      ['Royal Flush', 'AsKsQsJsTs', '0,0032 %'],
      ['Straight Flush', '9h8h7h6h5h', '0,028 %'],
      ['Vierling', 'QsQhQdQc7s', '0,168 %'],
      ['Full House', 'KsKhKd4c4s', '2,60 %'],
      ['Flush', 'AdJd8d5d2d', '3,03 %'],
      ['Straße', 'Ts9h8d7c6s', '4,62 %'],
      ['Drilling', '7s7h7dKcQs', '4,83 %'],
      ['Zwei Paare', 'JsJhAdAc9s', '23,5 %'],
      ['Ein Paar', 'TsThAdKc4s', '43,8 %'],
      ['High Card', 'AsJh8d5c3s', '17,4 %'],
    ];
    $('#rankTable').innerHTML = '<tr><th>#</th><th>Hand</th><th>Beispiel</th><th class="num">7 Karten</th></tr>' + rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r[0]}</td><td>${ex(r[1])}</td><td class="num">${r[2]}</td></tr>`).join('');

    let ot = '<tr><th>Outs</th><th>Beispiel</th><th class="num">Turn</th><th class="num">River</th><th class="num">Flop→River</th></tr>';
    const exs = { 2: 'Pocket-Paar → Set', 4: 'Gutshot', 6: 'Zwei Overcards', 8: 'Open-Ender', 9: 'Flush-Draw', 12: 'Flush-Draw + Gutshot', 15: 'Flush-Draw + Open-Ender' };
    for (const o of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
      ot += `<tr><td>${o}</td><td class="muted">${exs[o] || ''}</td><td class="num">${pct(o / 47)}</td><td class="num">${pct(o / 46)}</td><td class="num">${pct(E.hitProbability(o, 47, 2))}</td></tr>`;
    }
    $('#outsTable').innerHTML = ot;

    $('#typesTable').innerHTML =
      '<tr><th>Typ</th><th class="num">VPIP</th><th class="num">PFR</th><th>Bedeutung &amp; Gegenstrategie</th></tr>' +
      Object.values(TYPES).map((t) => `<tr><td><b>${t.name}</b></td><td class="num">${t.vpip} %</td><td class="num">${t.pfr} %</td><td>${t.desc}</td></tr>`).join('');
    renderMatrix();
  }

  function renderMatrix() {
    const p = +$('#matrixRange').value;
    $('#matrixPct').textContent = p;
    const set = E.topRange(p);
    let html = '';
    for (let i = 12; i >= 0; i--)
      for (let j = 12; j >= 0; j--) {
        const cls = i === j ? E.RANKS[i] + E.RANKS[j] : i > j ? E.RANKS[i] + E.RANKS[j] + 's' : E.RANKS[j] + E.RANKS[i] + 'o';
        html += `<div class="mcell ${set.has(cls) ? 'in' : ''} ${i === j ? 'pair' : ''}" title="Top ${fmt(E.handPercentile(cls) * 100, 1)} %">${cls}</div>`;
      }
    $('#matrix').innerHTML = html;
  }

  // ---------------- Events ----------------
  function bind() {
    document.addEventListener('click', (ev) => {
      const t = ev.target.closest('button, [data-view]');
      if (!t) return;
      if (t.classList.contains('tab')) return showView(t.dataset.view);
      if (t.classList.contains('slot')) return onSlotTap(t);
      if (t.classList.contains('pick')) return onPick(+t.dataset.card);
      if (t.dataset.load) {
        const h = history.find((x) => x.id === t.dataset.load);
        if (h) {
          state = { ...freshState(), ...JSON.parse(JSON.stringify(h.state)), editingId: h.id };
          active = null;
          renderForm();
          changed(true);
          showView('analyse');
        }
        return;
      }
      if (t.dataset.del) {
        if (confirm('Diese Hand löschen?')) {
          history = history.filter((x) => x.id !== t.dataset.del);
          save(HIST_KEY, history);
          renderHistory();
        }
        return;
      }
      if (t.dataset.act !== undefined && t.classList.contains('chip')) {
        state.heroAction = t.dataset.act;
        $$('#heroActions .chip').forEach((b) => b.classList.toggle('active', b === t));
        return changed();
      }
      if (t.dataset.quick) {
        const bb = num(state.bb);
        const base = defaultPot();
        if (t.dataset.quick === 'none') {
          state.pot = base;
          state.toCall = state.position === 'BB' ? 0 : state.position === 'SB' || state.position === 'BTN/SB' ? bb - num(state.sb) : bb;
        } else if (t.dataset.quick === 'limp') {
          state.pot = base + bb;
          state.toCall = state.position === 'BB' ? 0 : bb;
          state.opponents[0].action = 'call';
          state.opponents[0].manual = false;
        } else {
          state.pot = base + 2.5 * bb;
          state.toCall = 2.5 * bb - (state.position === 'BB' ? bb : state.position === 'SB' ? num(state.sb) : 0);
          state.opponents[0].action = 'raise';
          state.opponents[0].manual = false;
        }
        renderForm();
        return changed(true);
      }
      if (t.dataset.f === 'auto') {
        const i = +t.closest('.opp').dataset.opp;
        state.opponents[i].manual = false;
        return changed(true);
      }
      switch (t.id) {
        case 'btnResetCards':
          state.hero = [null, null];
          state.board = [null, null, null, null, null];
          state.dead = [];
          active = { group: 'hero', idx: 0 };
          return changed(true);
        case 'oppPlus':
          if (state.opponents.length < 8) state.opponents.push(newOpponent());
          return changed(true);
        case 'oppMinus':
          if (state.opponents.length > 1) state.opponents.pop();
          return changed(true);
        case 'btnSave':
          return saveHand();
        case 'btnNew': {
          const keep = { sb: state.sb, bb: state.bb, ante: state.ante, players: state.players, position: state.position, stack: state.stack };
          state = freshState(keep);
          state.pot = defaultPot();
          active = { group: 'hero', idx: 0 };
          renderForm();
          return changed(true);
        }
        case 'btnExport': {
          const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'poker-haende-' + new Date().toISOString().slice(0, 10) + '.json';
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          return;
        }
      }
    });

    // Formularfelder
    ['sb', 'bb', 'ante', 'stack', 'pot', 'toCall', 'oppStack', 'note'].forEach((id) =>
      $('#' + id).addEventListener('input', () => {
        readForm();
        changed();
      })
    );
    ['players', 'position'].forEach((id) =>
      $('#' + id).addEventListener('change', () => {
        readForm();
        renderForm();
        changed();
      })
    );

    // Gegner-Felder (delegiert)
    $('#opponents').addEventListener('input', (ev) => {
      const el = ev.target;
      const box = el.closest('.opp');
      if (!box) return;
      const o = state.opponents[+box.dataset.opp];
      const f = el.dataset.f;
      if (f === 'range') {
        o.range = +el.value;
        o.manual = true;
        el.nextElementSibling.textContent = el.value + ' %';
        save(STORE_KEY, state);
        clearTimeout(timer);
        timer = setTimeout(() => {
          renderOpponents();
          lastAnalysis = analyse();
          renderResults();
        }, 250);
        return;
      }
    });
    $('#opponents').addEventListener('change', (ev) => {
      const el = ev.target;
      const box = el.closest('.opp');
      if (!box) return;
      const i = +box.dataset.opp;
      const o = state.opponents[i];
      const f = el.dataset.f;
      if (f === 'showCards') {
        o.showCards = el.checked;
        if (el.checked) active = { group: 'opp', idx: 0, opp: i };
        else if (active && active.group === 'opp') active = null;
      } else if (f === 'type' || f === 'action' || f === 'post') {
        o[f] = el.value;
        o.manual = false;
      } else return;
      changed(true);
    });

    $('#importFile').addEventListener('change', (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!Array.isArray(data)) throw new Error();
          const ids = new Set(history.map((h) => h.id));
          const fresh = data.filter((h) => h && h.id && h.state && h.summary && !ids.has(h.id));
          history = [...fresh, ...history].sort((a, b) => b.ts - a.ts);
          save(HIST_KEY, history);
          renderHistory();
          toast(fresh.length + ' Hände importiert');
        } catch (e) {
          toast('Datei konnte nicht gelesen werden');
        }
        ev.target.value = '';
      };
      reader.readAsText(file);
    });

    $('#matrixRange').addEventListener('input', renderMatrix);
  }

  // ---------------- Start ----------------
  bind();
  renderForm();
  renderKnowledge();
  renderHistory();
  advanceActive();
  if (state.hero.every((c) => c === null)) active = { group: 'hero', idx: 0 };
  changed(true);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
