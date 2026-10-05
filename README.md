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
- Přepínání světlého/tmavého režimu (vpravo nahoře), barevné schéma
  růžová + tmavě zelená.
- Responzivní — na mobilu se tabulka kandidátů mění na přehledné kartičky.

## Struktura projektu

```
index.html                        # hlavní stránka
css/styles.css                    # styly, light/dark theme
js/app.js                         # veškerá logika — filtrování, přehledy, grafy, přepínání měst
data/candidates-praha12.json      # strukturovaná data kandidátů pro Prahu 12 (generovaná)
data/candidates-praha11.json      # strukturovaná data kandidátů pro Prahu 11 (generovaná)
scripts/parse_candidates.py       # skript pro vygenerování obou souborů v data/
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

