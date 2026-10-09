# Volby Praha 1–22 a Magistrát — přehled kandidátů 2026

Statická webová aplikace s přehledem kandidátů do zastupitelstev všech 22
číslovaných městských částí Prahy (Praha 1 až Praha 22) a celoměstského
Zastupitelstva hlavního města Prahy (magistrát) pro komunální volby 2026
(9.–10. 10. 2026). Přepínání mezi nimi je vpravo nahoře v hlavičce
(rozbalovací seznam).

## Funkce

- Přepínání mezi 22 městskými částmi (Praha 1–22) a magistrátem (celoměstské
  Zastupitelstvo hl. m. Prahy) — vpravo nahoře.
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
  postupně se plnící mandáty (jméno + strana + počet preferenčních hlasů),
  seřazené a barevně odlišené podle stran. Automatické obnovení dat každých
  60 s (lze vypnout) + tlačítko pro okamžité obnovení.
- Přepínání světlého/tmavého režimu (vpravo nahoře), barevné schéma
  růžová + tmavě zelená.
- Responzivní — na mobilu se tabulka kandidátů mění na přehledné kartičky.

## Struktura projektu

```
index.html                        # hlavní stránka
css/styles.css                    # styly, light/dark theme
js/app.js                         # veškerá logika — filtrování, přehledy, grafy, přepínání měst, výsledky
data/candidates-praha{1..22}.json # strukturovaná data kandidátů pro Prahu 1-22 (generovaná)
data/candidates-magistrat.json    # strukturovaná data kandidátů pro celoměstské zastupitelstvo (generovaná)
data/results-praha{1..22}.json    # data pro záložku Výsledky (zatím UKÁZKOVÁ, viz níže)
data/results-magistrat.json       # data pro záložku Výsledky za magistrát (zatím UKÁZKOVÁ, viz níže)
scripts/parse_candidates.py       # skript pro vygenerování candidates-*.json
scripts/generate_sample_results.py # skript pro vygenerování ukázkových dat results-*.json
```

## Zdroj dat

Data o kandidátech (jméno, věk, povolání) pocházejí z Českého statistického
úřadu, zprostředkovaná přes [Poradnu pro obce](https://www.poradnaproobce.cz/komunalni-volby-2026/kandidatni-listiny/praha-12-547107).
Pohlaví kandidátů není v datech uvedeno explicitně — u části kandidátů je
odhadnuto heuristikou podle křestního jména a koncovky příjmení (se seznamem
ručních výjimek pro nestandardní případy). V případě chyby v odhadu pohlaví
prosím upravte `GENDER_OVERRIDES` ve `scripts/parse_candidates.py` a znovu
spusťte skript.

Skutečná velikost zastupitelstva (`totalSeats`) pro každou část vychází
z oficiálních výsledků voleb 2022 (`volby.gov.cz`) — je daná statutem městské
části a mezi volbami se nemění; viz `DISTRICT_SEATS` ve
`scripts/generate_sample_results.py` (magistrát má 65 členů, viz
`MUNICIPALITIES["magistrat"]` tamtéž).

### Aktualizace dat

1. Stáhněte aktuální HTML stránky s kandidátkami (např. přes `Invoke-WebRequest`
   s běžným prohlížečovým `User-Agent`, jinak web vrátí jen úvodní stránku)
   do `%TEMP%\praha{N}_candidates.html` pro každou část (resp.
   `%TEMP%\magistrat_candidates.html` pro celoměstské zastupitelstvo).
2. Spusťte `python scripts/parse_candidates.py` — přegeneruje všechny soubory
   v `data/`. Lze spustit i jen pro některá města: `python scripts/parse_candidates.py praha11 praha12 magistrat`.

### Přidání další městské části

Číslované části Praha 1–22 a celoměstské zastupitelstvo (magistrát) jsou už
všechny zahrnuté. Pro přidání jiné (např. některé z menších městských částí
jako Praha-Zličín) přidejte záznam do `MUNICIPALITIES` ve
`scripts/parse_candidates.py` (název, zdrojová HTML stránka, URL zdroje,
výstupní soubor), do `DISTRICT_SEATS`/`MUNICIPALITIES` ve
`scripts/generate_sample_results.py` (reálná velikost zastupitelstva) a do
`MUNICIPALITIES` v `js/app.js` (popisek, zkratka do odznaku, cesta k JSON
souborům) — přepínač v `index.html` (`#municipality-select`) se pak naplní
automaticky.

## Záložka Výsledky — stav a napojení reálných dat

`data/results-praha{1..22}.json` a `data/results-magistrat.json` obsahují
**zatím jen ukázková, náhodně vygenerovaná data**
(`scripts/generate_sample_results.py`), protože skutečné výsledky zveřejní
ČSÚ až v průběhu a po volbách (9.–10. 10. 2026). Stránka na to upozorňuje
žlutým banerem, dokud `isSample` v datech je `true`.

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

