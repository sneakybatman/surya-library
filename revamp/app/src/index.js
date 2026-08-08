// Library Surya Foundation — Cloudflare Worker: static assets + JSON API.
// Auth: one shared family PIN -> signed cookie valid 1 year (see design/01 §3).

const COOKIE = "lib_auth";
const YEAR_S = 365 * 24 * 3600;

const enc = new TextEncoder();

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function makeCookie(env) {
  const exp = Math.floor(Date.now() / 1000) + YEAR_S;
  const sig = await hmac(env.AUTH_SECRET, "lib|" + exp);
  return `${COOKIE}=${exp}.${sig}; Max-Age=${YEAR_S}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

async function isAuthed(req, env) {
  const m = (req.headers.get("Cookie") || "").match(
    new RegExp(`${COOKIE}=(\\d+)\\.([0-9a-f]+)`));
  if (!m) return false;
  const [, exp, sig] = m;
  if (Number(exp) < Date.now() / 1000) return false;
  return sig === await hmac(env.AUTH_SECRET, "lib|" + exp);
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

// Best-effort brute-force damper; per-isolate memory is fine at family scale.
const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
  attempts.set(ip, a);
  return a.length >= 5;
}

async function listBooks(env) {
  const { results: books } = await env.DB.prepare(
    "SELECT id,title,title_hi,author,author_hi,author2,publisher,publisher_place," +
    "pub_year,pages,language,isbn,subject,series_name,volume_no,notes,search_text " +
    "FROM book WHERE hidden=0 ORDER BY title").all();
  const { results: copies } = await env.DB.prepare(
    "SELECT id,book_id,accession_no,copy_no,almirah_no,shelf_no,status,remarks " +
    "FROM copy ORDER BY book_id,copy_no").all();
  const byBook = new Map();
  for (const c of copies) {
    if (!byBook.has(c.book_id)) byBook.set(c.book_id, []);
    byBook.get(c.book_id).push(c);
  }
  for (const b of books) b.copies = byBook.get(b.id) || [];
  return books;
}

const BOOK_FIELDS = ["title", "title_hi", "author", "author_hi", "author2",
  "publisher", "publisher_place", "pub_year", "pages", "language", "isbn",
  "subject", "series_name", "volume_no", "notes", "search_text"];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (!path.startsWith("/api/")) return env.ASSETS.fetch(req);

    if (path === "/api/login" && req.method === "POST") {
      const ip = req.headers.get("CF-Connecting-IP") || "?";
      if (rateLimited(ip)) return json({ error: "too_many_attempts" }, 429);
      const { pin } = await req.json().catch(() => ({}));
      if (pin !== env.PIN) {
        attempts.get(ip).push(Date.now());
        return json({ error: "wrong_pin" }, 401);
      }
      return json({ ok: true }, 200, { "Set-Cookie": await makeCookie(env) });
    }

    if (!(await isAuthed(req, env))) return json({ error: "auth" }, 401);

    if (path === "/api/books" && req.method === "GET")
      return json({ books: await listBooks(env) });

    if (path === "/api/books" && req.method === "POST") {
      const b = await req.json();
      if (!b.title) return json({ error: "title_required" }, 400);
      const cols = BOOK_FIELDS.filter(f => b[f] !== undefined);
      const r = await env.DB.prepare(
        `INSERT INTO book (${cols.join(",")},added_by) VALUES ` +
        `(${cols.map(() => "?").join(",")},'app') RETURNING id`)
        .bind(...cols.map(f => b[f])).first();
      await env.DB.prepare(
        "INSERT INTO copy (book_id,copy_no,almirah_no,shelf_no,added_by) " +
        "VALUES (?,1,?,?,'app')")
        .bind(r.id, b.almirah_no ?? null, b.shelf_no ?? null).run();
      return json({ id: r.id });
    }

    let m;
    if ((m = path.match(/^\/api\/books\/(\d+)$/)) && req.method === "PUT") {
      const b = await req.json();
      const cols = BOOK_FIELDS.filter(f => b[f] !== undefined);
      if (b.hidden !== undefined) cols.push("hidden");
      if (!cols.length) return json({ error: "no_fields" }, 400);
      await env.DB.prepare(
        `UPDATE book SET ${cols.map(f => f + "=?").join(",")},` +
        "updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(...cols.map(f => b[f]), m[1]).run();
      return json({ ok: true });
    }

    if ((m = path.match(/^\/api\/copies\/(\d+)$/)) && req.method === "PATCH") {
      const c = await req.json();
      const allowed = ["almirah_no", "shelf_no", "status", "remarks"];
      const cols = allowed.filter(f => c[f] !== undefined);
      if (!cols.length) return json({ error: "no_fields" }, 400);
      if (c.status && !["available", "issued", "lost", "written_off"].includes(c.status))
        return json({ error: "bad_status" }, 400);
      await env.DB.prepare(
        `UPDATE copy SET ${cols.map(f => f + "=?").join(",")},` +
        "updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(...cols.map(f => c[f]), m[1]).run();
      if (c.status === "issued")
        await env.DB.prepare(
          "INSERT INTO loan (copy_id,borrower,issued_on) VALUES (?,?,date('now'))")
          .bind(m[1], c.borrower || "Family").run();
      if (c.status === "available")
        await env.DB.prepare(
          "UPDATE loan SET returned_on=date('now') " +
          "WHERE copy_id=? AND returned_on IS NULL").bind(m[1]).run();
      return json({ ok: true });
    }

    if (path === "/api/export" && req.method === "GET") {
      const books = await listBooks(env);
      const cols = ["id", "title", "title_hi", "author", "publisher", "pub_year",
        "pages", "language", "accession_no", "copy_no", "almirah_no", "shelf_no",
        "status"];
      const esc = v => v == null ? "" : /[",\n]/.test(String(v))
        ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
      const lines = [cols.join(",")];
      for (const b of books)
        for (const c of b.copies)
          lines.push(cols.map(k => esc(k in b ? b[k] : c[k])).join(","));
      return new Response(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=library-books.csv",
        },
      });
    }

    return json({ error: "not_found" }, 404);
  },
};
