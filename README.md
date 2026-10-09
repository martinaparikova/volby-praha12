# Volby Praha 12 / Praha 11 — přehled kandidátů 2026

Statická webová aplikace s přehledem kandidátů do zastupitelstev MČ Praha 12 a
MČ Praha 11 pro komunální volby 2026 (9.–10. 10. 2026). Přepínání mezi oběma
městskými částmi je vpravo nahoře v hlavičce.

## Funkce

- Přepínání mezi městskými částmi (Praha 12 / Praha 11) — vpravo nahoře.
- Seznam kandidátů rozklikávací podle jednotlivých kandidátních listin, nebo
  zobrazení všech kandidátů najednou v jedné tabulce.
- Filtrování podle věku (rozsahový slider) a pohlaví.
- Vyhledávání podle jména nebo povolání.
- Přehledy a statistiky: poměr žen a mužů, průměrný věk — celkem i jen pro
  TOP N kandidátů z každé kandidátky (N je nastavitelné, výchozí hodnota 10).
- Srovnávací grafy a tabulka kandidátek (počet kandidátů, poměr žen/mužů,
  průměrný věk), s možností řazení.
- Záložka **Výsledky** pro sledování výsledků voleb v noci z 9. na 10. 10.:
  průběh sečtených okrsků, volební účast, průběžné výsledky kandidátek a
  postupně se plnící mandáty (jméno + strana). Automatické obnovení dat
  každých 60 s (lze vypnout) + tlačítko pro okamžité obnovení.
- Přepínání světlého/tmavého režimu (vpravo nahoře), barevné schéma
  růžová + tmavě zelená.
- Responzivní — na mobilu se tabulka kandidátů mění na přehledné kartičky.

## Struktura projektu

```
index.html                        # hlavní stránka
css/styles.css                    # styly, light/dark theme
js/app.js                         # veškerá logika — filtrování, přehledy, grafy, přepínání měst, výsledky
data/candidates-praha12.json      # strukturovaná data kandidátů pro Prahu 12 (generovaná)
data/candidates-praha11.json      # strukturovaná data kandidátů pro Prahu 11 (generovaná)
data/results-praha12.json         # data pro záložku Výsledky (zatím UKÁZKOVÁ, viz níže)
data/results-praha11.json         # data pro záložku Výsledky (zatím UKÁZKOVÁ, viz níže)
scripts/parse_candidates.py       # skript pro vygenerování obou souborů candidates-*.json
scripts/generate_sample_results.py # skript pro vygenerování ukázkových dat results-*.json
```

## Zdroj dat

Data o kandidátech (jméno, věk, povolání) pocházejí z Českého statistického
úřadu, zprostředkovaná přes [Poradnu pro obce](https://www.poradnaproobce.cz/komunalni-volby-2026/kandidatni-listiny/hlavni-mesto-praha/hlavni-mesto-praha/praha/praha-12-547107).
Pohlaví kandidátů není v datech uvedeno explicitně — u části kandidátů je
odhadnuto heuristikou podle křestního jména a koncovky příjmení (se seznamem
ručních výjimek pro nestandardní případy). V případě chyby v odhadu pohlaví
prosím upravte `GENDER_OVERRIDES` ve `scripts/parse_candidates.py` a znovu
spusťte skript.

### Aktualizace dat

1. Stáhněte aktuální HTML stránky s kandidátkami (např. přes `Invoke-WebRequest`)
   do `%TEMP%\praha12_candidates.html` (resp. `%TEMP%\praha11_candidates.html`).
2. Spusťte `python scripts/parse_candidates.py` — přegeneruje oba soubory
   v `data/`. Lze spustit i jen pro jedno město: `python scripts/parse_candidates.py praha11`.

### Přidání další městské části

V `scripts/parse_candidates.py` přidejte záznam do `MUNICIPALITIES` (název,
zdrojová HTML stránka, URL zdroje, výstupní soubor) a v `js/app.js` obdobný
záznam do `MUNICIPALITIES` (popisek, zkratka do odznaku, cesta k JSON souboru).
Tlačítko v přepínači měst přidejte do `index.html` (`#municipality-switch`).

## Záložka Výsledky — stav a napojení reálných dat

`data/results-praha12.json` a `data/results-praha11.json` obsahují **zatím
jen ukázková, náhodně vygenerovaná data** (`scripts/generate_sample_results.py`),
protože skutečné výsledky zveřejní ČSÚ až v průběhu a po volbách (9.–10. 10.
2026). Stránka na to upozorňuje žlutým banerem, dokud `isSample` v datech je
`true`.

Formát souboru `results-*.json`:

```jsonc
{
  "municipality": "Praha 12",
  "isSample": true,              // smazat/nastavit na false u ostrých dat
  "sampleNote": "...",           // text žlutého baneru (jen když isSample)
  "precinctsTotal": 28,          // celkem okrsků
  "precinctsCounted": 18,        // sečteno okrsků
  "turnoutPercent": 47.2,        // volební účast
  "totalSeats": 35,              // velikost zastupitelstva
  "parties": [ { "id": 1, "name": "...", "votesPercent": 20.5, "seats": 8 } ],
  "seats": [ { "seatNumber": 1, "name": "Jméno Příjmení", "partyId": 1, "partyName": "...", "preferenceVotes": 187 } ]
  // "name"/"partyId"/"partyName"/"preferenceVotes" = null u dosud nerozhodnutého křesla
}
```

V záložce Výsledky se karty v `#results-seats-grid` zobrazují seřazené podle
stran (v pořadí dle `parties`, tj. podle podílu hlasů) a uvnitř strany podle
`preferenceVotes` sestupně; jednotlivé strany jsou odlišené střídavým
podbarvením karet. Dosud nerozhodnutá křesla (`partyId: null`) se zobrazují
na konci.

Až ČSÚ zveřejní skutečný formát (pravděpodobně XML na `volby.gov.cz/appdata/kv2026/...`,
viz [dokumentace otevřených dat](https://volby.gov.cz/opendata/kv2026/kv2026_opendata_seznam.htm)),
bude potřeba napsat obdobný převodní skript jako `parse_candidates.py`, který
z reálného zdroje vygeneruje JSON ve výše uvedeném tvaru — samotná stránka
(`index.html`/`js/app.js`) se měnit nemusí. Do té doby lze `results-*.json`
periodicky přegenerovat (`python scripts/generate_sample_results.py`) jen pro
vývoj/náhled.

Stránka data obnovuje automaticky každých 60 s (dá se vypnout zaškrtávátkem),
plus je tlačítko „Aktualizovat teď“ pro okamžité obnovení.

## Spuštění lokálně

Aplikace je čistě statická (HTML/CSS/JS bez buildu), ale kvůli `fetch()` nad
daty v `data/` je potřeba ji servírovat přes HTTP (ne přímo z disku):

```powershell
python -m http.server 8765
```

a pak otevřít `http://localhost:8765/`.

## Nasazení na GitHub Pages

Stačí v nastavení repozitáře (Settings → Pages) zapnout GitHub Pages pro větev
`main` a kořenovou složku `/`.

