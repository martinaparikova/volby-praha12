"""
Parses the official ČSÚ candidate lists (zprostředkované přes poradnaproobce.cz)
for Prague city districts, municipal elections 2026, from a saved HTML page
into structured JSON.

Usage:
  python scripts/parse_candidates.py [slug ...]   # defaults to all municipalities
"""
import json
import os
import re
import sys
import tempfile

from bs4 import BeautifulSoup

MUNICIPALITIES = {
    "praha12": {
        "name": "Praha 12",
        "html_file": "praha12_candidates.html",
        "source_url": "https://www.poradnaproobce.cz/komunalni-volby-2026/kandidatni-listiny/hlavni-mesto-praha/hlavni-mesto-praha/praha/praha-12-547107",
        "out_file": "candidates-praha12.json",
    },
    "praha11": {
        "name": "Praha 11",
        "html_file": "praha11_candidates.html",
        "source_url": "https://www.poradnaproobce.cz/komunalni-volby-2026/kandidatni-listiny/hlavni-mesto-praha/hlavni-mesto-praha/praha/praha-11-547034",
        "out_file": "candidates-praha11.json",
    },
}

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

# Academic/professional titles that can precede or follow a candidate's name
# on Czech ballots. Stripped out to isolate the given/first name for gender
# detection.
TITLE_TOKENS = {
    "Bc.", "BcA.", "Ing.", "arch.", "JUDr.", "MUDr.", "MVDr.", "PaedDr.",
    "PhDr.", "RNDr.", "Mgr.", "prof.", "doc.", "Dipl.", "DiS.", "DrSc.",
    "CSc.", "Ph.D.", "MBA", "MPA", "MPH", "LLM", "LL.M.", "ThDr.",
    "ThLic.", "PharmDr.", "et",
}

# Manual overrides for first names where the "ends with -a => female" Czech
# heuristic would misclassify (foreign names, or well-known exceptions).
GENDER_OVERRIDES = {
    "attila": "M",
    "lingli": "F",
    "petri": "F",
    "ingrid": "F",
    "karin": "F",
}


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def guess_gender(first_name, last_name):
    # Strongest signal: Czech feminine surnames almost always end in "á"
    # (e.g. "-ová", "-ská", "-cká", or plain adjectival "-á"). Male surnames
    # never end this way, so this overrides the first-name heuristic below.
    if last_name and last_name.rstrip(".,").endswith("á"):
        return "F"
    if not first_name:
        return None
    key = first_name.lower()
    if key in GENDER_OVERRIDES:
        return GENDER_OVERRIDES[key]
    return "F" if key.endswith("a") else "M"


def name_tokens_without_titles(full_name):
    tokens = full_name.split(" ")
    return [t for t in tokens if t.rstrip(",") not in TITLE_TOKENS]


def first_name_of(full_name):
    kept = name_tokens_without_titles(full_name)
    return kept[0] if kept else None


def last_name_of(full_name):
    kept = name_tokens_without_titles(full_name)
    return kept[-1] if kept else None


def parse(src_path):
    with open(src_path, encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    sections = soup.select("section.cmp_election_openable_section")
    parties = []

    for idx, section in enumerate(sections, start=1):
        header = section.select_one(".cmp_election_openable_section_header__title")
        subtitle = section.select_one(".cmp_election_openable_section_header__subtitle")
        if not header:
            continue
        party_name = clean(header.get_text())
        count_match = re.search(r"(\d+)", subtitle.get_text() if subtitle else "")
        candidate_count = int(count_match.group(1)) if count_match else None

        candidates = []
        # Real data rows (not the "label" duplicate rows used for mobile view)
        rows = section.select("tr.cmpt_election_table_responsive__ln")
        for row in rows:
            number_cell = row.select_one(".pg_election_candidate_lists_table__ln_cell_label--number")
            name_cell = row.select_one("th.cmpt_election_table_responsive__ln_cell_label.w-100")
            profession_cell = row.select_one('td[data-label="Povolání"]')
            if not name_cell:
                continue

            number = clean(number_cell.get_text()) if number_cell else None
            full_text = clean(name_cell.get_text())
            age_match = re.search(r"\((\d+)\s*let\)", full_text)
            age = int(age_match.group(1)) if age_match else None
            name = clean(name_cell.find("strong").get_text()) if name_cell.find("strong") else re.sub(r"\s*\(\d+\s*let\)", "", full_text)
            profession = clean(profession_cell.get_text()) if profession_cell else None
            gender = guess_gender(first_name_of(name), last_name_of(name))

            candidates.append(
                {
                    "number": int(number) if number and number.isdigit() else None,
                    "name": name,
                    "age": age,
                    "gender": gender,
                    "profession": profession,
                }
            )

        parties.append(
            {
                "id": idx,
                "name": party_name,
                "candidateCount": candidate_count,
                "candidates": candidates,
            }
        )

    return parties


def run_for(slug):
    config = MUNICIPALITIES[slug]
    src_path = os.path.join(tempfile.gettempdir(), config["html_file"])
    out_path = os.path.join(DATA_DIR, config["out_file"])

    parties = parse(src_path)
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "municipality": config["name"],
                "election": "Volby do zastupitelstev obcí 2026",
                "source": config["source_url"],
                "sourceNote": "Data ČSÚ, zprostředkovaná přes Poradna pro obce",
                "parties": parties,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    total = sum(len(p["candidates"]) for p in parties)
    print(f"[{config['name']}] parties: {len(parties)}, total candidates parsed: {total}")
    for p in parties:
        print(f"  - {p['name']}: {len(p['candidates'])} (expected {p['candidateCount']})")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    slugs = sys.argv[1:] or list(MUNICIPALITIES.keys())
    for slug in slugs:
        if slug not in MUNICIPALITIES:
            print(f"Unknown municipality slug: {slug} (known: {', '.join(MUNICIPALITIES)})")
            continue
        run_for(slug)
