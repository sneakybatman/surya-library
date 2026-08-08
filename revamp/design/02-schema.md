# Home Library Database Design (ACC_REG Migration)

> **Reality check (added after data extraction):** the actual dumps show that of the 67
> old columns only these carry real data: `ACCC_NO`, `TITLE`, `AUTHOR_1`,
> `AUTHOR_2` (a `TITLE-AUTHOR` composite), `PUBLISHER_NAME` (~99%), `YEAR` (~90%),
> `PG_COUNT` (~98%). `ALMIRAH_NO`, `SHELF_NO`, `NOOFCOPIES`, `ISBN`, `LANGUAGE`,
> `SUBJECT_HEAD`, `AVAILABILITY` etc. are **empty** (one stray test row aside).
> The schema below still stands — location/status fields start NULL and get filled
> by the family. Copies exist as duplicate rows (53 titles), not via NOOFCOPIES.

## 1. Modeling decisions

**Two core tables: `book` (bibliographic title) and `copy` (physical item).** ACC_REG is an accession register: one row ≈ one physical copy, with duplicate title rows. Splitting title from copy is the one normalization that pays for itself: search and Devanagari enrichment happen once per title; location, condition, and availability are per copy. Migration dedupes on normalized `(title, author_1)`.

**Authors and publishers stay as text columns — deliberately.** At ~2,000 rows the transliterated names are too inconsistent (`PREMCHANDRA` vs `PREMCHAND`, `RENU,PHADISHWARNATH`) for an authority table to be anything but a manual cleanup project with no query payoff; search normalization (Section 3) delivers the benefit an author table would. Promote to a table later only if the family wants author browse pages.

**Location is two small integers on `copy`** (`almirah_no`, `shelf_no`) with CHECK constraints. Almirahs are just numbered cupboards; a `location` table would be a join with no information in it.

**Availability** is a `status` column on `copy` (`available | issued | lost | written_off`) plus a minimal optional `loan` table for "who borrowed it" — families lend books; six columns buys that.

**Audit** is pragmatic: `added_by TEXT`, `created_at`, `updated_at` on both core tables. No user table, no audit log — it's a family.

**Dual-script future**: nullable `title_hi` / `author_hi` (Devanagari) exist from day one; search is designed so filling them in later requires no schema change.

## 2. DDL (portable SQLite / Postgres)

```sql
-- Divergence note (the only one that matters):
--   SQLite : id INTEGER PRIMARY KEY                       (rowid alias, auto-increments)
--   Postgres: id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY
-- Everything else below runs unchanged on both. SQLite stores DATE/TIMESTAMP
-- as ISO-8601 text; always write 'YYYY-MM-DD'.

CREATE TABLE book (
    id              INTEGER PRIMARY KEY,          -- see divergence note
    title           TEXT NOT NULL,                -- transliterated, Title Case
    title_hi        TEXT,                         -- Devanagari, filled later
    author          TEXT,                         -- primary author, transliterated
    author_hi       TEXT,                         -- Devanagari
    author2         TEXT,                         -- secondary author/editor
    publisher       TEXT,
    publisher_place TEXT,
    pub_year        INTEGER CHECK (pub_year BETWEEN 1400 AND 2100),
    edition         TEXT,
    pages           INTEGER,
    language        TEXT NOT NULL DEFAULT 'Hindi',
    isbn            TEXT,                         -- nullable, NOT unique (dirty/absent)
    class_no        TEXT,                         -- legacy classification, kept for shelf order
    book_no         TEXT,
    series_name     TEXT,
    volume_no       TEXT,
    subject         TEXT,
    price           NUMERIC(10,2),
    binding         TEXT,                         -- 'hardbound' | 'paperback' | NULL
    notes           TEXT,                         -- merged misc legacy fields
    search_text     TEXT NOT NULL DEFAULT '',     -- maintained by app; see Section 3
    added_by        TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE copy (
    id              INTEGER PRIMARY KEY,          -- see divergence note
    book_id         INTEGER NOT NULL REFERENCES book(id) ON DELETE CASCADE,
    accession_no    INTEGER UNIQUE,               -- legacy ACCC_NO; NULL for post-migration adds
    copy_no         INTEGER NOT NULL DEFAULT 1,   -- 1..n within a book
    almirah_no      INTEGER CHECK (almirah_no > 0),
    shelf_no        INTEGER CHECK (shelf_no > 0),
    status          TEXT NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available','issued','lost','written_off')),
    condition       TEXT,                         -- free text: 'good', 'binding loose'…
    accessioned_on  DATE,
    remarks         TEXT,
    added_by        TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (book_id, copy_no)
);

CREATE TABLE loan (                               -- optional but cheap
    id              INTEGER PRIMARY KEY,          -- see divergence note
    copy_id         INTEGER NOT NULL REFERENCES copy(id),
    borrower        TEXT NOT NULL,
    issued_on       DATE NOT NULL,
    due_on          DATE,
    returned_on     DATE                          -- NULL = still out
);

CREATE INDEX idx_copy_book     ON copy(book_id);
CREATE INDEX idx_copy_location ON copy(almirah_no, shelf_no);
CREATE INDEX idx_book_title    ON book(title);
CREATE INDEX idx_loan_open     ON loan(copy_id, returned_on);
```

**Search index appendix (per engine, applied by the deployment script):**

```sql
-- SQLite: FTS5 external-content table + sync triggers
CREATE VIRTUAL TABLE book_fts USING fts5(
    title, author, search_text, content='book', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER book_ai AFTER INSERT ON book BEGIN
  INSERT INTO book_fts(rowid,title,author,search_text)
  VALUES (new.id,new.title,new.author,new.search_text); END;
CREATE TRIGGER book_ad AFTER DELETE ON book BEGIN
  INSERT INTO book_fts(book_fts,rowid,title,author,search_text)
  VALUES ('delete',old.id,old.title,old.author,old.search_text); END;
CREATE TRIGGER book_au AFTER UPDATE ON book BEGIN
  INSERT INTO book_fts(book_fts,rowid,title,author,search_text)
  VALUES ('delete',old.id,old.title,old.author,old.search_text);
  INSERT INTO book_fts(rowid,title,author,search_text)
  VALUES (new.id,new.title,new.author,new.search_text); END;

-- Postgres: trigram index (substring + typo tolerance beats tsvector at this scale)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_book_trgm ON book USING gin (search_text gin_trgm_ops);
```

## 3. Search design (dual-script)

At 2,000 rows any index is "fast"; the real problem is **matching across scripts and spelling drift**. Solution: one app-maintained `search_text` column holding every searchable form, recomputed on write.

**`search_text` =** lowercase Latin-folded title + authors + series, **plus** the raw Devanagari `title_hi`/`author_hi`, **plus** a Latin transliteration of the Devanagari (Hunterian-style, via e.g. Python `indic-transliteration` or a ~60-line consonant/vowel map). Example: `gaban | premchandra | premchand | गबन | प्रेमचंद`.

**Latin folding rules** (applied to both stored text and incoming queries — this is what makes `PREMCHANDRA`, `premchand`, and transliterated `प्रेमचंद` converge): lowercase; strip punctuation/diacritics; collapse whitespace; `aa→a, ee→i, ii→i, oo→u, uu→u, w→v, chch→ch, sh→s, ph→f (keep original token too)`. Store both raw and folded tokens so precision isn't lost.

**Query pipeline** (app layer): if the query contains Devanagari codepoints (U+0900–U+097F), transliterate it to folded Latin and search *both* forms; if Latin, fold it. Then: SQLite → `SELECT rowid FROM book_fts WHERE book_fts MATCH 'gaban* OR premchand*'` (prefix `*` makes `premchand` find `premchandra`); Postgres → `WHERE search_text ILIKE '%'||q||'%' OR similarity(search_text, q) > 0.3` on the trigram index. Either way: typing `गबन` or `gaban` finds the same row.

## 4. Migration mapping (all 67 columns)

| Old column | Disposition | Reason |
|---|---|---|
| DATED | → `copy.accessioned_on` | Accession date, per copy (constant 2019-06-01 in practice — bulk import date) |
| ACCC_NO | → `copy.accession_no` | Natural key of the register; kept unique |
| CLASS_NO | → `book.class_no` | Constant '0' in practice → NULL |
| BOOK_NO | → `book.book_no` | Constant '0' in practice → NULL |
| AUTHOR_1 | → `book.author` | Core |
| AUTHOR_2 | → `book.author2` | In practice holds `TITLE-AUTHOR` composite → validation only |
| TITLE | → `book.title` | Core |
| PUBLISHER_NAME | → `book.publisher` | Split trailing `,PLACE` (see cleaning) |
| PLACE | → `book.publisher_place` | Fallback when not fused in publisher |
| COLLN_TYPE | dropped | Empty |
| TYPE_OF_MATERIAL | dropped | Empty |
| YEAR | → `book.pub_year` | Parsed to INTEGER |
| EDITION | → `book.edition` | Empty in practice |
| PG_COUNT | → `book.pages` | Parsed; merged with PEGINATION (first non-null) |
| ILLUST / BK_SIZE | dropped | Empty |
| ISBN | → `book.isbn` | Empty in practice; column kept for new entries |
| LANGUAGE | → `book.language` | Empty → infer Hindi/English during migration |
| SCRIPT_USED / TRANSLATED | dropped / notes | Empty |
| SUBJECT_HEAD | → `book.subject` | Empty in practice; column kept |
| PHY_MED | dropped | Empty |
| PRICE | → `book.price` | Merged with ACTUAL_PR (first parseable) |
| TYPE_OF_BINDING | → `book.binding` | Merged with BK_BINDING, normalized |
| DOC_NO / KEY | dropped | Derived `TITLE-AUTHOR` composite; migration cross-check only |
| SERIES_NAME | → `book.series_name` | Kept |
| ISSN_NO / VOL_NO / PEGINATION / TITLE_VOLUME | see above / notes | VOL_NO → `book.volume_no` |
| ENTRY_ELEMENT, OTHER_NAME, ADDRESS, COUNTRY, BIBLIO_GRAPHY | dropped | Empty boilerplate |
| MEETING_* (5 cols) | dropped | Conference-proceedings fields, empty |
| ISSUE / CUR / FCUR | dropped | Empty |
| REMARKS | → `copy.remarks` | Merged with BK_INFO |
| WRITTENOFF | → `copy.status='written_off'` | Flag → enum |
| NOOFCOPIES | (empty) | Copies exist as duplicate rows instead |
| EDITOR / EDITOR_TYPE | notes / dropped | Sparse |
| BK_INFO | → `copy.remarks` | Misc |
| ISSUED / ISS | → `copy.status='issued'` + seed `loan` | Flag → enum |
| COND_BOOK | → `copy.condition` | Per copy |
| AVAILABILITY | merged → `copy.status` | Precedence: written_off > issued > available |
| NEW_CLASS_NO | merged → `book.class_no` | Wins over CLASS_NO |
| ORDER_NO / WITH_MEDIA / REFERENCE | dropped / notes | Empty |
| DISC_PR / ACTUAL_PR | dropped / price fallback | |
| SNO / ACCREGDATE / ACCCC_NO | dropped / fallbacks | ACCC_NO is the provenance key |
| ALMIRAH_NO / SHELF_NO | → `copy.almirah_no` / `copy.shelf_no` | **Empty in both dumps — to be filled by family** |
| HINDI | merged → `book.language` | Constant 0 in practice |

## 5. Data-cleaning rules (in migration script order)

1. **Trim & collapse**: strip leading/trailing whitespace, collapse internal runs to one space, empty string → NULL — every column. (Real data has trailing spaces: `MANSAROVAR -7`.)
2. **Case**: ALL-CAPS → Title Case for title/author/publisher/place/series (`GABAN` → `Gaban`), preserving initials-with-commas (`Renu, Phanishwarnath` from `RENU,PHADISHWARNATH` — add space after comma; keep `S.K.` intact).
3. **Composite `AUTHOR_2`/`DOC_NO`/`KEY`**: do **not** blind-split on hyphen (titles contain hyphens: `MANSAROVAR -7`). Instead strip the known `-<AUTHOR_1>` suffix and assert the remainder equals TITLE; log mismatches for manual review. These columns are validation input only.
4. **Publisher fused with place**: if PLACE is null and publisher matches `X,CITY` against a known city list (Delhi, Mumbai, Gorakhpur, Allahabad, Varanasi…), split into publisher/publisher_place.
5. **Year**: extract first 4-digit `18xx–20xx` from YEAR (handles `1994`, `1994-95`, `C1994`); Vikram Samvat years (>2081) → subtract 57 and note; unparseable → NULL + log.
6. **Price**: PRICE as-is; else strip `Rs`, `/-`, commas from ACTUAL_PR and parse; unparseable → NULL.
7. **Almirah/shelf**: strip non-digits (`AL-3`, `3A` → log the `A`), cast to int; 0/blank → NULL.
8. **Pages**: first integer from PG_COUNT else PEGINATION (`234p.` → 234).
9. **ISBN**: strip hyphens/spaces; keep only 10/13-char results with valid checksum, else move raw value to notes.
10. **Status precedence**: WRITTENOFF ∈ (Y,YES,1) → `written_off`; else ISSUED/ISS truthy → `issued` + loan row (`borrower='(unknown - migrated)'`); else `available`.
11. **Dedup into `book`**: group rows by folded `(title, author)` (Section 3 folding, so `MANSAROVER-2`/`MANSAROVAR -2` don't merge wrongly — volume digit is part of the key); each group → one book, each row → one copy row, `copy_no` sequential; log groups whose other bibliographic fields disagree.
12. **Language inference** (new — LANGUAGE column is empty): classify Hindi vs English heuristically (publisher names like Rajkamal/Gita Press/Vani → Hindi; Penguin/HarperCollins + English-looking titles → English); log low-confidence rows for a quick manual pass.
13. **Every dropped-but-non-null oddity** goes to `notes`/`remarks` — nothing is silently discarded.
14. `added_by = 'migration'`, `created_at = now`, `search_text` computed last.

## 6. Example transformations

**Old rows (abridged):**

| ACCC_NO | TITLE | AUTHOR_1 | AUTHOR_2 | PUBLISHER_NAME | YEAR | WRITTENOFF |
|---|---|---|---|---|---|---|
| 101 | `GABAN` | `PREMCHANDRA` | `GABAN-PREMCHANDRA` | `RAJKAMAL PRAKASHAN,DELHI` | `1994` | |
| 102 | `GABAN ` | `PREMCHANDRA` | `GABAN-PREMCHANDRA` | `RAJKAMAL PRAKASHAN,DELHI` | `1994` | `Y` |
| 205 | `MAILA AANCHAL` | `RENU,PHADISHWARNATH` | `MAILA AANCHAL-RENU,PHADISHWARNATH` | `RAJKAMAL PRAKASHAN` | `C1990` | |

**New `book` rows:**

| id | title | title_hi | author | publisher | publisher_place | pub_year | search_text (excerpt) |
|---|---|---|---|---|---|---|---|
| 1 | Gaban | गबन *(added later)* | Premchandra | Rajkamal Prakashan | Delhi | 1994 | `gaban premchandra premchand गबन प्रेमचंद` |
| 2 | Maila Aanchal | *(null)* | Renu, Phanishwarnath | Rajkamal Prakashan | *(null)* | 1990 | `maila anchal aanchal renu phanishvarnath` |

**New `copy` rows** (rows 101+102 deduped into book 1):

| id | book_id | accession_no | copy_no | almirah_no | shelf_no | status | added_by |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 101 | 1 | *(null)* | *(null)* | available | migration |
| 2 | 1 | 102 | 2 | *(null)* | *(null)* | written_off | migration |
| 3 | 2 | 205 | 1 | *(null)* | *(null)* | available | migration |

Searching `गबन`, `gaban`, or `premchand` all resolve to book 1; once the family fills in locations the app shows "2 copies — 1 available — Almirah 2, Shelf 3."
