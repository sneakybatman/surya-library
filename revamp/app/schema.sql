-- Library Surya Foundation — D1 (SQLite) schema.
-- Search is client-side over /api/books, so no FTS tables here (see design/01 §1).

CREATE TABLE IF NOT EXISTS book (
    id              INTEGER PRIMARY KEY,
    title           TEXT NOT NULL,
    title_hi        TEXT,
    author          TEXT,
    author_hi       TEXT,
    author2         TEXT,
    publisher       TEXT,
    publisher_place TEXT,
    pub_year        INTEGER CHECK (pub_year BETWEEN 1400 AND 2100),
    edition         TEXT,
    pages           INTEGER,
    language        TEXT NOT NULL DEFAULT 'Hindi',
    isbn            TEXT,
    class_no        TEXT,
    book_no         TEXT,
    series_name     TEXT,
    volume_no       TEXT,
    subject         TEXT,
    price           NUMERIC,
    binding         TEXT,
    notes           TEXT,
    summary         TEXT,
    search_text     TEXT NOT NULL DEFAULT '',
    hidden          INTEGER NOT NULL DEFAULT 0,
    added_by        TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS copy (
    id              INTEGER PRIMARY KEY,
    book_id         INTEGER NOT NULL REFERENCES book(id) ON DELETE CASCADE,
    accession_no    INTEGER UNIQUE,
    copy_no         INTEGER NOT NULL DEFAULT 1,
    almirah_no      INTEGER CHECK (almirah_no > 0),
    shelf_no        INTEGER CHECK (shelf_no > 0),
    status          TEXT NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available','issued','lost','written_off')),
    condition       TEXT,
    accessioned_on  DATE,
    remarks         TEXT,
    added_by        TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (book_id, copy_no)
);

CREATE TABLE IF NOT EXISTS loan (
    id              INTEGER PRIMARY KEY,
    copy_id         INTEGER NOT NULL REFERENCES copy(id),
    borrower        TEXT NOT NULL,
    issued_on       DATE NOT NULL,
    due_on          DATE,
    returned_on     DATE
);

CREATE INDEX IF NOT EXISTS idx_copy_book     ON copy(book_id);
CREATE INDEX IF NOT EXISTS idx_copy_location ON copy(almirah_no, shelf_no);
CREATE INDEX IF NOT EXISTS idx_book_title    ON book(title);
CREATE INDEX IF NOT EXISTS idx_loan_open     ON loan(copy_id, returned_on);
