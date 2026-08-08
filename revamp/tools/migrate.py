#!/usr/bin/env python3
"""Migrate the extracted ACC_REG CSV into clean book/copy rows.

Applies the cleaning rules from revamp/design/02-schema.md §5 and writes:
  revamp/app/seed/seed.sql      -- batched INSERTs for D1/SQLite
  revamp/data/migration_log.txt -- every judgement call, for manual review
"""
import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "DataBackup130722_acc_reg.csv"
SEED = ROOT / "app" / "seed" / "seed.sql"
LOG = ROOT / "data" / "migration_log.txt"

CITIES = {
    "DELHI": "Delhi", "NEW DELHI": "New Delhi", "N.D.": "New Delhi",
    "ND": "New Delhi", "NEWDELHI": "New Delhi", "MUMBAI": "Mumbai",
    "BOMBAY": "Mumbai", "GORAKHPUR": "Gorakhpur", "ALLAHABAD": "Allahabad",
    "VARANASI": "Varanasi", "KOLKATA": "Kolkata", "CALCUTTA": "Kolkata",
    "LUCKNOW": "Lucknow", "JAIPUR": "Jaipur", "AGRA": "Agra",
    "MEERUT": "Meerut", "NOIDA": "Noida", "CHENNAI": "Chennai",
    "MADRAS": "Chennai", "PATNA": "Patna", "PUNE": "Pune",
    "HYDERABAD": "Hyderabad", "BANGALORE": "Bangalore", "LONDON": "London",
    "NEW YORK": "New York", "HARIDWAR": "Haridwar", "RISHIKESH": "Rishikesh",
    "MATHURA": "Mathura", "KANPUR": "Kanpur", "RAJASTHAN": "Rajasthan",
}

HINDI_PUBLISHERS = re.compile(
    r"GITA PRESS|GEETA PRESS|RAJKAMAL|VANI PRAKASHAN|RAJPAL|GYANPEETH"
    r"|HIND POCKET|HANS PRAKASHAN|LOKBHARTI|KITABGHAR|PRABHAT PRAKASHAN"
    r"|SAHITYA|SUMAN PRAKASHAN|ARYA|NYAS|TRUST|ASHRAM|SANSTHAN|MANDIR"
    r"|PUSTAK|PRAKASHAN|BHawan|BHAWAN|BHARTI", re.I)
ENGLISH_PUBLISHERS = re.compile(
    r"PENGUIN|HARPER|COLLINS|RANDOM HOUSE|SIMON|MACMILLAN|OXFORD|CAMBRIDGE"
    r"|BLOOMSBURY|HACHETTE|SCHOLASTIC|PUFFIN|POCKET BOOKS|BANTAM|VINTAGE"
    r"|ORIENT|RUPA|JAICO|WILEY|PEARSON|GRAFTON|ARROW|CORONET|PAN BOOKS"
    r"|HODDER|HEADLINE|SPHERE|FONTANA|PICADOR|ABACUS|BERKLEY|SIGNET", re.I)
ENGLISH_WORDS = re.compile(
    r"\b(THE|OF|AND|IN|TO|FOR|YOUR|HOW|WHAT|WHO|WHY|IS|ARE|MY|LIFE|BOOK"
    r"|STORY|STORIES|WORLD|MAN|WOMAN|LOVE|WAR|HISTORY|GUIDE|ART|NIGHT"
    r"|DAY|HOUSE|DEATH|SECRET|LAST|FIRST|GREAT|COMPLETE|SELECTED)\b", re.I)

log_lines = []


def log(msg):
    log_lines.append(msg)


def clean(s):
    if s is None:
        return None
    s = re.sub(r"\s+", " ", s).strip()
    return s or None


def title_case(s):
    if not s:
        return s
    out = []
    for w in s.split(" "):
        if re.fullmatch(r"[IVX]+\.?", w):        # roman numeral volumes
            out.append(w)
        elif "." in w and all(len(p) <= 2 for p in w.split(".") if p):
            out.append(w.upper())                 # initials like H.J.
        else:
            out.append(w[:1].upper() + w[1:].lower())
    s = " ".join(out)
    return re.sub(r",(?=\S)", ", ", s)            # RENU,PHADISHWARNATH spacing


def fold(s):
    """Latin folding per 02-schema.md §3 — applied to index and queries alike."""
    if not s:
        return ""
    s = s.lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    words = []
    for w in s.split(" "):
        w = re.sub(r"aa+", "a", w)
        w = re.sub(r"ee+", "i", w)
        w = re.sub(r"ii+", "i", w)
        w = re.sub(r"oo+", "u", w)
        w = re.sub(r"uu+", "u", w)
        w = w.replace("w", "v").replace("chch", "ch")
        w = w.replace("sh", "s").replace("ph", "f")
        w = re.sub(r"([bcdfghjklmnpqrstvz])a$", r"\1", w)  # premchandra~premchand tail
        words.append(w)
    return " ".join(words)


def split_publisher(pub):
    if not pub:
        return None, None
    m = re.match(r"^(.*?),\s*([A-Z .]+?)\.?$", pub)
    if m and m.group(2).strip().upper() in CITIES:
        return clean(m.group(1)), CITIES[m.group(2).strip().upper()]
    m = re.match(r"^(.+?)\s+N\.?D\.?$", pub)
    if m:
        return clean(m.group(1)), "New Delhi"
    return pub, None


def parse_year(y):
    if not y:
        return None
    m = re.search(r"\b(1[89]\d\d|20\d\d)\b", y)
    if m:
        return int(m.group(1))
    log(f"unparseable year: {y!r}")
    return None


def parse_pages(p):
    if not p:
        return None
    m = re.search(r"\d+", p)
    return int(m.group()) if m else None


def infer_language(title, publisher):
    blob = f"{publisher or ''}"
    if ENGLISH_PUBLISHERS.search(blob):
        return "English", True
    if HINDI_PUBLISHERS.search(blob):
        return "Hindi", True
    if title and ENGLISH_WORDS.search(title):
        return "English", False
    return "Hindi", False


def sql_str(v):
    if v is None:
        return "NULL"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def main():
    rows = list(csv.DictReader(SRC.open(encoding="utf-8")))
    log(f"input rows: {len(rows)}")

    books = {}      # fold key -> book dict
    copies = []
    low_conf_lang = 0

    for r in rows:
        title_raw = clean(r["TITLE"])
        author_raw = clean(r["AUTHOR_1"])
        if not title_raw:
            log(f"SKIP row ACCC_NO={r['ACCC_NO']}: no title "
                f"(author2={r['AUTHOR_2']!r})")
            continue

        # AUTHOR_2 is a TITLE-AUTHOR composite in ~100% of rows: validate, don't split
        author2 = clean(r["AUTHOR_2"])
        if author2:
            expect = re.sub(r"[\s-]", "", f"{title_raw}{author_raw or ''}").lower()
            got = re.sub(r"[\s-]", "", author2).lower()
            if got == expect or got.startswith(re.sub(r"[\s-]", "", title_raw).lower()):
                author2 = None                    # derived composite, discard
            else:
                log(f"AUTHOR_2 kept for #{r['ACCC_NO']}: {r['AUTHOR_2']!r}")

        publisher, place = split_publisher(clean(r["PUBLISHER_NAME"]))
        year = parse_year(clean(r["YEAR"]))
        pages = parse_pages(clean(r["PG_COUNT"]))
        lang, confident = infer_language(title_raw, publisher)
        if not confident:
            low_conf_lang += 1

        title = title_case(title_raw)
        author = title_case(author_raw)
        key = (fold(title_raw), fold(author_raw or ""))
        if key not in books:
            search = " ".join(
                x for x in [title_raw.lower(), fold(title_raw),
                            (author_raw or "").lower(), fold(author_raw or "")]
                if x)
            books[key] = {
                "id": len(books) + 1, "title": title, "author": author,
                "author2": title_case(author2) if author2 else None,
                "publisher": title_case(publisher), "publisher_place": place,
                "pub_year": year, "pages": pages, "language": lang,
                "search_text": search, "n": 0,
            }
        else:
            b = books[key]
            for field, val in (("pub_year", year), ("pages", pages),
                               ("publisher", title_case(publisher))):
                if b[field] and val and b[field] != val:
                    log(f"copy disagreement {title!r} {field}: "
                        f"{b[field]!r} vs {val!r} (kept first)")
                b[field] = b[field] or val
        b = books[key]
        b["n"] += 1
        copies.append({"book_id": b["id"], "accession_no": int(r["ACCC_NO"]),
                       "copy_no": b["n"], "accessioned_on": r["DATED"] or None})

    log(f"books: {len(books)}, copies: {len(copies)}, "
        f"multi-copy titles: {sum(1 for b in books.values() if b['n'] > 1)}, "
        f"low-confidence language: {low_conf_lang}")

    SEED.parent.mkdir(parents=True, exist_ok=True)
    with SEED.open("w", encoding="utf-8") as f:
        f.write("-- generated by tools/migrate.py; do not edit by hand\n")
        blist = list(books.values())
        for i in range(0, len(blist), 50):
            f.write("INSERT INTO book (id,title,author,author2,publisher,"
                    "publisher_place,pub_year,pages,language,search_text,added_by)"
                    " VALUES\n")
            f.write(",\n".join(
                "(" + ",".join(sql_str(v) for v in (
                    b["id"], b["title"], b["author"], b["author2"],
                    b["publisher"], b["publisher_place"], b["pub_year"],
                    b["pages"], b["language"], b["search_text"], "migration"))
                + ")" for b in blist[i:i + 50]) + ";\n")
        for i in range(0, len(copies), 50):
            f.write("INSERT INTO copy (book_id,accession_no,copy_no,"
                    "accessioned_on,added_by) VALUES\n")
            f.write(",\n".join(
                "(" + ",".join(sql_str(v) for v in (
                    c["book_id"], c["accession_no"], c["copy_no"],
                    c["accessioned_on"], "migration"))
                + ")" for c in copies[i:i + 50]) + ";\n")
    LOG.write_text("\n".join(log_lines) + "\n", encoding="utf-8")
    print(f"wrote {SEED} ({len(books)} books, {len(copies)} copies)")
    print(f"wrote {LOG} ({len(log_lines)} log lines)")


if __name__ == "__main__":
    sys.exit(main())
