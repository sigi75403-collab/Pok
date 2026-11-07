# ♠ Poker Hand-Analyse (iPad)

Web-App zum **nachträglichen Analysieren einzelner Pokerhände**: Hände nach dem Turnier eintragen und auswerten lassen. Die App läuft im Safari auf dem iPad, lässt sich wie eine normale App auf den Home-Bildschirm legen und funktioniert danach auch offline. Alle Daten bleiben lokal auf dem Gerät.

> Gedacht für die Nachbereitung und zum Lernen. Bei Echtgeld-Turnieren (z. B. PokerStars) sind Hilfsmittel, die während einer laufenden Hand Entscheidungen empfehlen, verboten. Nutze die App also zwischen den Sessions.

## Funktionen

**Analyse**
- Karten per Antippen eingeben: eigene Hand, Flop/Turn/River, **tote Karten** (gefoldet gezeigte, bekannte Karten). Sie fließen in alle Wahrscheinlichkeiten ein.
- Blinds, Ante, Spielerzahl, Position, Stack, Pot, Betrag zum Callen
- Bis zu 8 Gegner, jeweils mit **Spielertyp** (Rock, TAG, Calling Station, LAG, Maniac), Preflop-Aktion und Postflop-Aktion. Daraus ergibt sich eine geschätzte Range, die du per Regler auch selbst festlegen kannst. Wenn ein Gegner setzt, filtert die App seine Range nach dem Board: Behalten werden Treffer, Draws und Bluffs, Letztere mit dem Bluff-Anteil des Spielertyps.
- Optional bekannte Gegnerkarten (Showdown)

**Ergebnis**
- Empfehlung (Fold / Check / Call / Bet / Raise / All-in) mit Begründung und Einsatzgröße
- **Equity** per Monte-Carlo-Simulation (Gewinn/Split/Verlust), Pot Odds, benötigte Equity, Call-EV in BB, SPR
- **Outs** mit Karten, exakte Trefferchance (nächste Karte / bis River) und Faustregel 2/4
- Draws (Flush-Draw, Open-Ender, Gutshot) und Board-Textur
- Wahrscheinlichkeit für jede Handkategorie am River
- Turnier: Stack in BB, M-Ratio, Harrington-Zone, **Push/Fold** ab ≤ 15 BB (Näherung an Nash-Ranges)
- Bewertung deiner **tatsächlichen Aktion** (✓ / ≈ / ✗ inkl. EV-Verlust)

**Verlauf**: Hände speichern, wieder öffnen, Notizen, Statistik (Anteil richtiger Entscheidungen, EV-Verlust), Export/Import als JSON

**Wissen**: Handrangfolge mit Wahrscheinlichkeiten, Outs-Tabelle, 13×13-Starthand-Matrix mit Range-Regler, Spielertypen

## Auf das iPad bringen

1. **GitHub Pages aktivieren**: im Repo unter *Settings → Pages → Source: GitHub Actions*. Nach dem nächsten Push auf `main` steht die App unter `https://<benutzer>.github.io/<repo>/` bereit. Bei privaten Repos setzt Pages einen kostenpflichtigen GitHub-Plan voraus. Alternativ funktioniert jeder statische Hoster wie Netlify oder Cloudflare Pages: einfach den Ordner hochladen.
2. Die Adresse auf dem iPad in **Safari** öffnen.
3. **Teilen → „Zum Home-Bildschirm“** wählen. Ab dann startet die App im Vollbild und funktioniert offline.

Lokal testen: `npm start` und danach `http://localhost:8080` aufrufen.

## Entwicklung

- `engine.js`: Handbewertung (7 Karten), Equity, Outs, Draws, Ranges, ohne Abhängigkeiten
- `app.js`: Oberfläche und Empfehlungslogik
- `preflop-data.js`: Rangliste der 169 Starthände, erzeugt mit `npm run preflop`
- `npm test`: Tests, u. a. Prüfung des Evaluators gegen alle 2.598.960 Fünf-Karten-Kombinationen
- Nach Änderungen an den App-Dateien `VERSION` in `sw.js` erhöhen, damit installierte Apps das Update erhalten.

## Grenzen

Die Empfehlungen beruhen auf Heuristiken (Equity gegen Pot Odds, Standard-Eröffnungsranges, Push/Fold-Näherung) und nicht auf einem GTO-Solver. ICM und spätere Setzrunden (Implied Odds) werden nur grob berücksichtigt. Die Gegner-Ranges sind Annahmen auf Basis des gewählten Spielertyps.
