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
  oficiální mandáty po úplném sečtení (jméno + strana + počet hlasů kandidáta),
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
scripts/parse_real_results.py     # skript pro převod ostrých dat ČSÚ na results-*.json (viz níže)
scripts/update_csu.py             # aktualizace platných kandidátů a oficiálních průběžných výsledků
scripts/test_update_csu.py        # regresní testy oficiálního XML
```

## Zdroj dat

Data o kandidátech (jméno, věk, povolání) pocházejí přímo z
[oficiálního registru ČSÚ](https://volby.gov.cz/opendata/kv2026/xml/kvrk.zip).
Zahrnují pouze kandidáty s `PLATNOST=A`. Neplatní kandidáti (`PLATNOST=N`)
jsou vyřazeni z tabulek i statistik; původní čísla kandidátů se zachovávají.
Názvy a čísla listin jsou převzaty z oficiálního výsledkového XML.
Původní import z Poradny pro obce zůstává jen jako historická vývojová pomůcka.
Pohlaví kandidátů není v datech uvedeno explicitně — u části kandidátů je
odhadnuto heuristikou podle křestního jména a koncovky příjmení (se seznamem
ručních výjimek pro nestandardní případy). V případě chyby v odhadu pohlaví
prosím upravte `GENDER_OVERRIDES` ve `scripts/parse_candidates.py` a znovu
spusťte skript.

Skutečná velikost zastupitelstva (`totalSeats`) i celkový počet okrsků
pocházejí z aktuálního výsledkového XML ČSÚ pro rok 2026, nikoliv z archivu 2022.
Průběžné výsledky se načítají ze souhrnného XML za okres Praha, které se
aktualizuje při sčítání; jednotlivé XML soubory zastupitelstev mohou zůstat
zastaralé.
Pokud nový import nahlásí méně sečtených okrsků než předchozí zveřejněná verze
stejného zastupitelstva, předchozí výsledky se zachovají. Publikační workflow
proto před importem načte dosavadní výsledkové JSON soubory z webu.

### Aktualizace dat

Spusťte `python scripts\update_csu.py` pro aktualizaci všech zahrnutých
zastupitelstev, nebo `python scripts\update_csu.py praha12` jen pro Prahu 12.
Aktualizují se kandidáti i výsledky. Nepoužívejte starý HTML import pro
aktualizaci ostrých dat, protože nefiltruje neplatné kandidáty.

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
**oficiální průběžná data ČSÚ**. Nulový počet sečtených okrsků není ukázka.
Dokud není zastupitelstvo úplně sečtené (`isComplete=false`), oficiální
mandáty jednotlivých stran jsou `null` a jména zvolených zastupitelů se
nezobrazují. Po započtení prvního okrsku ale záložka Výsledky průběžně
odhaduje rozdělení mandátů ze součtu hlasů. Odhad uplatňuje zákonnou
uzavírací klauzuli: 5 % z průměrného počtu hlasů na mandát násobených počtem
kandidátů listiny, nejvýše počtem mandátů, a poté d'Hondtovu metodu. Může se
měnit s každou aktualizací; oficiální mandáty a zvolení kandidáti se zobrazí
až po úplném sečtení. Účast je při nulovém počtu sečtených okrsků `null`,
nikoliv skutečných 0 %.

Ve výsledcích kandidátek jsou listiny s podílem hlasů pod 5 % oddělené
do šedě podbarvené skupiny. Přesně 5 % patří do horní skupiny.
Toto vizuální rozdělení podle zobrazeného podílu hlasů nemění výpočet
mandátů ani zákonnou uzavírací klauzuli zohledňující počet kandidátů.
Čas dat ČSÚ odpovídá času vygenerování souhrnného XML; při pravidelném načtení
dat se nemění, pokud ČSÚ mezitím nové výsledky nezveřejní.

Formát souboru `results-*.json`:

```jsonc
{
  "municipality": "Praha 12",
  "isSample": false,
  "isComplete": false,
  "generatedAt": "2026-10-10T15:00:00", // čas dat ČSÚ, nikoliv obnovení prohlížeče
  "precinctsTotal": 50,          // celkem okrsků
  "precinctsCounted": 18,        // sečteno okrsků
  "turnoutPercent": 47.2,        // volební účast
  "totalSeats": 35,              // velikost zastupitelstva
  "parties": [ { "id": 1, "name": "...", "votes": 1234, "votesPercent": 20.5, "seats": null } ],
  "seats": [ { "seatNumber": 1, "name": null, "partyId": null, "partyName": null, "preferenceVotes": null } ]
  // "name"/"partyId"/"partyName"/"preferenceVotes" = null u dosud nerozhodnutého křesla
}
```

V záložce Výsledky se karty v `#results-seats-grid` zobrazují seřazené podle
stran (v pořadí dle `parties`, tj. podle podílu hlasů) a uvnitř strany podle
`preferenceVotes` sestupně; jednotlivé strany jsou odlišené střídavým
podbarvením karet. Dosud nerozhodnutá křesla (`partyId: null`) se zobrazují
na konci.

### Oficiální průběžné XML — `update_csu.py`

Skript používá [průběžné XML ČSÚ](https://volby.gov.cz/opendata/kv2026/KV2026_XML.htm),
konkrétně [souhrnné výsledky za okres Praha](https://volby.gov.cz/appdata/kv2026/20261009/odata/okresy/vysledky_obce_okres_CZ0100.xml),
které obsahují i zastupitelstva městských částí.
Přebírá procenta hlasů, volební účast, počty okrsků a velikost zastupitelstva.
Po dokončení sčítání převezme přímo přidělené mandáty a elementy `ZASTUPITEL`
s počty hlasů. Odhad neovlivňuje tento zdroj ani JSON; počítá se v prohlížeči
jen z průběžných hlasů a velikostí kandidátních listin.
„Čas dat ČSÚ“ odpovídá času vytvoření zdrojových dat. „Naposledy načteno“
ukazuje poslední úspěšné načtení zveřejněného JSON do prohlížeče, nikoliv
poslední stažení z ČSÚ. Při opakovaném načtení nezměněných dat se první
čas nemění; při chybě načtení se neposune ani druhý čas.

Skript před zápisem ověří všechny stažené obce. Chyba HTTP/XML, jiná obec,
neznámá platnost kandidáta či nesoulad počtů kandidátů/mandátů ukončí běh
s chybovou zprávou bez publikování vadné dávky. Jednotlivé soubory se nahrazují
atomicky. Při chybě obnovení v prohlížeči zůstanou poslední výsledky
s viditelným upozorněním.
Dočasné výpadky spojení, neúplné přenosy a HTTP 408/429/500/502/503/504
se opakují nejvýše čtyřikrát s čekáním 2, 4 a 8 sekund a zprávou v logu.
Po vyčerpání pokusů běh selže bez nasazení nové verze. Chyby validace,
neexistující soubory (404) a odmítnutý přístup (403) se neopakují.

```powershell
python scripts\update_csu.py                   # jednorázově všech 23 zastupitelstev
python scripts\update_csu.py praha12 --watch   # lokální aktualizace každých 60 s
python scripts\update_csu.py --watch           # totéž pro všechna zastupitelstva
python scripts\update_csu.py praha12 --output-dir C:\Temp\csu-test
```

Režim `--watch` běží v popředí a ukončuje se Ctrl+C. Při chybě skončí a
vypíše důvod; po odstranění problému je nutné ho znovu spustit.
Samotné obnovení stránky každých 60 s pouze načítá publikovaný JSON — ČSÚ
kontaktuje tento skript, lokálně nebo v GitHub Actions (viz nasazení níže).

Regresní testy:

```powershell
python -m unittest discover -s scripts -p test_update_csu.py -v
```

### Archivní a ukázkové skripty

`parse_real_results.py` je dřívější experiment pro archivní `kvt3.xml` a
`kvhl.xml`, které ČSÚ zveřejňuje až po ukončení zpracování. **Nepoužívejte ho
pro ostré výsledky**: jeho vlastní přepočet není ověřený na úplných reálných
datech. Průběžné XML nyní explicitně odmítá. Stejně tak
`generate_sample_results.py` slouží pouze k vývoji a přepsal by ostrá data
ukázkovými.

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

V Settings → Pages je jako zdroj nastaveno **GitHub Actions**. Workflow
`.github/workflows/publish.yml` při pushi do `main`, ručním spuštění a podle
plánu stáhne aktuální data ČSÚ, spustí regresní testy a publikuje statický web.
Používá vestavěný `GITHUB_TOKEN`, není potřeba přidávat osobní token ani tajné údaje.
Změny dat se necommitují zpět do repozitáře; jsou součástí publikovaného
Pages artefaktu. Lokální JSON a soubory v repozitáři proto nemusí mít stejný
čas jako aktuální veřejný web.

Automatické běhy jsou plánované každých **5 minut od 10. do 17. října 2026
(UTC)**. GitHub negarantuje přesný čas a může běhy opozdit. Kontrola roku
zabraňuje stahování a nasazování při opakování cronu v dalších letech.
Po volebním týdnu lze blok `schedule` odstranit; ruční spuštění a publikování
při pushi fungují dál.

Ruční aktualizace: GitHub → Actions → **Update CSU data and publish** →
**Run workflow**, větev `main`. V případě chyby stažení či validace se nová
verze nenasadí, předchozí web zůstane dostupný a běh skončí chybou v Actions.
„Čas dat ČSÚ“ ukazuje stáří zdrojových dat, „Naposledy načteno“ čas
posledního úspěšného načtení v prohlížeči.

### Dočasný minutový režim 10. října 2026

Workflow **Temporary minute updates until Prague midnight** běží na GitHubu
a každých 60 sekund žádá o nový běh publikačního workflow. Pokud předchozí
publikování stále běží nebo čeká, danou minutu přeskočí, aby nevznikala fronta.
Platí pouze 10. října 2026 od 14:00 do půlnoci českého času, tj. do
**22:00 UTC**. Běh spuštěný těsně před půlnocí může nasazení dokončit později.
Po půlnoci už koordinátor další aktualizace nespouští; pětiminutový plán
publikačního workflow zůstává aktivní.

Koordinátor se obnovuje hodinovým cronem a jeden běh trvá nejvýše 65 minut.
GitHub může obnovu opozdit; v případné mezeře funguje původní pětiminutový
plán. Nová aktualizace, stahování a nasazení proto nejsou zaručené přesně
každou minutu. Režim nezávisí na zapnutém lokálním počítači, nemění obsah
repozitáře a nevyžaduje osobní přístupový token.

Instalace závislostí pro samostatný lokální běh:

```powershell
python -m pip install -r scripts\requirements-csu.txt
```
