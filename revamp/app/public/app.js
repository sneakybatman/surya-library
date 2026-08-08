"use strict";
/* Panchvati Library — vanilla JS SPA. No build step, no dependencies.
   Search runs fully client-side over the /api/books payload so it is
   instant and works offline (design/01 §1, design/03 §4). */

const $app = document.getElementById("app");
let BOOKS = [];
let stickyAlmirah = 1, stickyShelf = 1;

/* ---------- Devanagari → Latin, then shared Latin folding ---------- */
const DEV = {
  "क":"k","ख":"kh","ग":"g","घ":"gh","ङ":"n","च":"ch","छ":"chh","ज":"j",
  "झ":"jh","ञ":"n","ट":"t","ठ":"th","ड":"d","ढ":"dh","ण":"n","त":"t",
  "थ":"th","द":"d","ध":"dh","न":"n","प":"p","फ":"ph","ब":"b","भ":"bh",
  "म":"m","य":"y","र":"r","ल":"l","व":"v","श":"sh","ष":"sh","स":"s",
  "ह":"h","क़":"q","ख़":"kh","ग़":"g","ज़":"z","ड़":"r","ढ़":"rh","फ़":"f",
  "अ":"a","आ":"aa","इ":"i","ई":"ee","उ":"u","ऊ":"oo","ए":"e","ऐ":"ai",
  "ओ":"o","औ":"au","ऋ":"ri","ा":"aa","ि":"i","ी":"ee","ु":"u","ू":"oo",
  "े":"e","ै":"ai","ो":"o","ौ":"au","ृ":"ri","ं":"n","ँ":"n","ः":"h",
  "ऑ":"o","ऍ":"e","ॉ":"o","ॅ":"e",
  "०":"0","१":"1","२":"2","३":"3","४":"4","५":"5","६":"6","७":"7","८":"8","९":"9",
};
const CONSONANT = /[क-हक़-य़]/;
// Only matras and virama suppress the inherent 'a'; anusvara/visarga do not.
const MATRA_OR_VIRAMA = /[ािीुूृेैोौॉॅ्]/;

function transliterate(s) {
  let out = "";
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "्") continue;                    // virama: no inherent vowel
    out += DEV[ch] ?? ch;
    if (CONSONANT.test(ch)) {
      const next = chars[i + 1] || "";
      if (!MATRA_OR_VIRAMA.test(next)) out += "a";    // inherent 'a'
    }
  }
  return out;
}

function fold(s) {
  if (!s) return "";
  if (/[ऀ-ॿ]/.test(s)) s = transliterate(s);
  s = s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return s.split(" ").map(w => {
    w = w.replace(/aa+/g, "a").replace(/ee+/g, "i").replace(/ii+/g, "i")
         .replace(/oo+/g, "u").replace(/uu+/g, "u")
         .replace(/w/g, "v").replace(/chch/g, "ch")
         .replace(/sh/g, "s").replace(/ph/g, "f");
    // Hindi schwa deletion is irregular ("premchand" vs "premachanda"), so
    // match on consonant skeletons: drop non-initial 'a' on index AND query.
    if (w.length > 2) w = w[0] + w.slice(1).replace(/a/g, "");
    return w;
  }).join(" ");
}

function editDist(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/* ---------- search ---------- */
function bookIndex(b) {
  if (!b._fold) {
    b._ftitle = fold((b.title_hi ? b.title_hi + " " : "") + (b.title || ""));
    b._fauthor = fold((b.author_hi ? b.author_hi + " " : "") + (b.author || ""));
    b._fold = (b._ftitle + " " + b._fauthor + " " + (b.search_text || "")).trim();
  }
  return b;
}

function search(q) {
  const fq = fold(q);
  if (fq.length < 2) return { hits: [], suggestions: [] };
  const hits = [];
  for (const b of BOOKS) {
    bookIndex(b);
    let score = -1;
    if (b._ftitle.startsWith(fq)) score = 100;
    else if (b._ftitle.includes(" " + fq)) score = 80;
    else if (b._ftitle.includes(fq)) score = 60;
    else if (b._fauthor.includes(fq)) score = 40;
    else if (b._fold.includes(fq)) score = 20;
    if (score >= 0) hits.push([score, b]);
  }
  hits.sort((x, y) => y[0] - x[0] || x[1].title.localeCompare(y[1].title));
  let suggestions = [];
  if (!hits.length) {                       // fuzzy: nearest titles, shown as-is
    const qw = fq.split(" ")[0];
    for (const b of BOOKS) {
      if (suggestions.length >= 3) break;
      const near = b._ftitle.split(" ").concat(b._fauthor.split(" "))
        .some(w => w.length > 2 && editDist(qw, w) <= 2);
      if (near) suggestions.push(b.title);
    }
  }
  return { hits: hits.map(h => h[1]), suggestions };
}

/* ---------- helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const STATUS = {
  available:   { en: "Available", cls: "ok" },
  issued:      { en: "Taken out", cls: "bad" },
  lost:        { en: "Lost",      cls: "bad" },
  written_off: { en: "Removed",   cls: "off" },
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" }, ...opts,
  });
  if (res.status === 401) { render("/login"); throw new Error("auth"); }
  if (!res.ok) throw new Error("api " + res.status);
  return res.json();
}

async function loadBooks(force = false) {
  if (BOOKS.length && !force) return;
  const cached = localStorage.getItem("books_v1");
  if (cached && !force) {
    BOOKS = JSON.parse(cached);
    refreshBooks();                          // background refresh, no await
    return;
  }
  const data = await api("/api/books");
  BOOKS = data.books;
  localStorage.setItem("books_v1", JSON.stringify(BOOKS));
}
async function refreshBooks() {
  try {
    const data = await api("/api/books");
    BOOKS = data.books;
    localStorage.setItem("books_v1", JSON.stringify(BOOKS));
  } catch (e) { /* offline is fine — cache serves */ }
}

/* ---------- routing ---------- */
function go(path) { history.pushState({}, "", path); render(path); }
window.addEventListener("popstate", () => render(location.pathname));
document.addEventListener("click", e => {
  const a = e.target.closest("a[data-nav]");
  if (a) { e.preventDefault(); go(a.getAttribute("href")); }
});

const topbar = () =>
  `<div class="topbar"><a class="btn secondary" data-nav href="/">⌂ Home</a></div>`;

async function render(path) {
  window.scrollTo(0, 0);
  let m;
  if (path === "/login") return viewLogin();
  try { await loadBooks(); } catch (e) { return; }   // 401 already routed
  if (path === "/") return viewHome();
  if ((m = path.match(/^\/book\/(\d+)$/))) return viewDetail(+m[1]);
  if (path === "/authors") return viewAuthors();
  if ((m = path.match(/^\/author\/(.+)$/))) return viewAuthorBooks(decodeURIComponent(m[1]));
  if (path === "/manage") return viewManage();
  if (path === "/add") return viewForm();
  if ((m = path.match(/^\/edit\/(\d+)$/))) return viewForm(+m[1]);
  if (path === "/catalog") return viewCatalog();
  go("/");
}

/* ---------- views ---------- */
function viewLogin() {
  $app.innerHTML = `
    <h1 class="brand">📚 Panchvati Library</h1>
    <p class="center">Enter the family PIN</p>
    <label for="pin">PIN</label>
    <input id="pin" type="password" inputmode="numeric" autocomplete="current-password">
    <div id="msg"></div>
    <button id="go">Enter</button>`;
  document.getElementById("go").onclick = async () => {
    const pin = document.getElementById("pin").value.trim();
    const msg = document.getElementById("msg");
    try {
      const res = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) { await loadBooks(true); go("/"); return; }
      msg.innerHTML = res.status === 429
        ? `<div class="strip err">Too many wrong attempts — try again in 15 minutes.</div>`
        : `<div class="strip err">Wrong PIN, please try again.</div>`;
    } catch (e) {
      msg.innerHTML = `<div class="strip err">No internet — please try again in a moment.</div>`;
    }
  };
}

function viewHome() {
  $app.innerHTML = `
    <h1 class="brand">📚 Panchvati Library</h1>
    <label for="q">Type book or author name</label>
    <input id="q" type="search" autocomplete="off">
    <div class="row2">
      <button id="mic" class="secondary">🎤 Speak</button>
      <button id="find">Search</button>
    </div>
    <div id="results"></div>
    <div class="home-btns">
      <a class="btn secondary" data-nav href="/authors">👤 Browse authors</a>
      <a class="btn secondary" data-nav href="/manage">🛠️ Manage</a>
    </div>`;
  const q = document.getElementById("q");
  const results = document.getElementById("results");
  let timer;
  const run = () => { results.innerHTML = resultsHTML(q.value); };
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 300); });
  document.getElementById("find").onclick = run;
  results.addEventListener("click", e => {
    const s = e.target.closest("button[data-suggest]");
    if (s) { q.value = s.dataset.suggest; run(); }
  });
  const mic = document.getElementById("mic");
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) mic.style.display = "none";
  else mic.onclick = () => {
    const rec = new SR();
    rec.lang = "hi-IN";
    mic.textContent = "🎙️ Listening…";
    rec.onresult = ev => { q.value = ev.results[0][0].transcript; run(); };
    rec.onend = () => { mic.innerHTML = `🎤 Speak`; };
    rec.start();
  };
}

function cardHTML(b) {
  const copies = b.copies || [];
  const avail = copies.filter(x => x.status === "available").length;
  const c = copies.find(x => x.status === "available") || copies[0];
  const st = STATUS[c?.status || "available"];
  const loc = c?.almirah_no
    ? ` · Almirah ${c.almirah_no}` : "";
  const n = copies.length || 1;
  const copiesTxt = n === 1 ? " · 1 copy"
    : avail > 0 && avail < n ? ` · ${avail} of ${n} copies in`
    : ` · ${n} copies`;
  return `<a class="card" data-nav href="/book/${b.id}">
    <div class="t">${esc(b.title)}</div>
    <div class="a">${esc(b.author || "")}</div>
    <div class="s"><span class="pill ${st.cls}">${st.en}</span>${copiesTxt}${loc}</div></a>`;
}

function resultsHTML(query, list) {
  const r = list ? { hits: list, suggestions: [] } : search(query);
  if (!list && fold(query).length < 2) return "";
  if (!r.hits.length) {
    const sug = r.suggestions.map(s =>
      `<button class="secondary" data-suggest="${esc(s)}">Did you mean “${esc(s)}”?</button>`).join("");
    return `<div class="count">No book called “${esc(query)}” found</div>${sug}
      <a class="btn secondary" data-nav href="/authors">👤 Browse authors</a>`;
  }
  const shown = r.hits.slice(0, 10);
  let html = `<div class="count">${r.hits.length} found</div>`
    + shown.map(cardHTML).join("");
  if (r.hits.length > 10)
    html += `<button class="secondary" onclick="this.outerHTML=window.__more()">Show more</button>`,
    window.__more = () => r.hits.slice(10, 50).map(cardHTML).join("");
  return html;
}

function viewDetail(id) {
  const b = BOOKS.find(x => x.id === id);
  if (!b) return go("/");
  const meta = [b.publisher, b.pub_year, b.pages && b.pages + " pages"]
    .filter(Boolean).join(" · ");
  $app.innerHTML = `
    ${topbar()}
    <h1 style="text-align:left">${esc(b.title)}</h1>
    ${b.title_hi ? `<div class="muted">${esc(b.title_hi)}</div>` : ""}
    <div>Author: <b>${esc(b.author || "—")}</b></div>
    <div id="copies"></div>
    <div class="muted">${esc(meta)}</div>
    <div class="spacer"></div>
    <a class="plain btn" data-nav href="/edit/${b.id}" style="border:none;background:none;color:var(--focus);text-decoration:underline">Edit details</a>`;
  renderCopies(b);
}

function copyPanel(b, c, i) {
  const st = STATUS[c.status];
  const many = b.copies.length > 1 ? ` (copy ${c.copy_no})` : "";
  const where = c.almirah_no
    ? `Almirah ${c.almirah_no} &nbsp;·&nbsp; Shelf ${c.shelf_no ?? "?"}`
    : `<div class="lbl" style="font-size:1.2rem">Location not recorded yet — ask the family</div>`;
  const btn = c.status === "available"
    ? `<button data-take="${c.id}">📕 Take out</button>`
    : c.status === "issued"
      ? `<button data-return="${c.id}">📗 Mark returned</button>`
      : "";
  return `<div class="locate"><div class="lbl">This book is here${many}:</div>
      <div class="where">${where}</div></div>
    <div class="statusline"><span class="pill ${st.cls}">${st.en}</span></div>
    <div id="strip-${c.id}"></div>${btn}`;
}

function renderCopies(b) {
  const wrap = document.getElementById("copies");
  wrap.innerHTML = b.copies.map((c, i) => copyPanel(b, c, i)).join("");
  wrap.onclick = async e => {
    const take = e.target.closest("[data-take]");
    const ret = e.target.closest("[data-return]");
    if (!take && !ret) return;
    const id = +(take || ret).dataset[take ? "take" : "return"];
    const c = b.copies.find(x => x.id === id);
    const newStatus = take ? "issued" : "available";
    const oldStatus = c.status;
    try {
      await api(`/api/copies/${id}`, { method: "PATCH", body: JSON.stringify({ status: newStatus }) });
    } catch (err) { return; }
    c.status = newStatus;
    localStorage.setItem("books_v1", JSON.stringify(BOOKS));
    renderCopies(b);
    const strip = document.getElementById(`strip-${id}`);
    strip.innerHTML = take
      ? `<div class="strip">✅ Marked as taken
           <button class="secondary" data-undo>Undo</button>
           <div>Who took it?</div>
           <div class="chips"><button class="secondary" data-who="Papa">Papa</button>
             <button class="secondary" data-who="Mummy">Mummy</button>
             <button class="secondary" data-who="Other">Other</button></div></div>`
      : `<div class="strip">✅ Done — put it back: Almirah ${c.almirah_no ?? "?"}, Shelf ${c.shelf_no ?? "?"}
           <button class="secondary" data-undo>Undo</button></div>`;
    strip.querySelector("[data-undo]").onclick = async () => {
      await api(`/api/copies/${id}`, { method: "PATCH", body: JSON.stringify({ status: oldStatus }) });
      c.status = oldStatus;
      localStorage.setItem("books_v1", JSON.stringify(BOOKS));
      renderCopies(b);
    };
    strip.querySelectorAll("[data-who]").forEach(btn => btn.onclick = async () => {
      await api(`/api/copies/${id}`, { method: "PATCH", body: JSON.stringify({ status: "issued", borrower: btn.dataset.who }) });
      btn.closest(".chips").innerHTML = `<div>✅ ${esc(btn.dataset.who)} — noted</div>`;
    });
  };
}

function viewAuthors() {
  const counts = new Map();
  for (const b of BOOKS) {
    const a = b.author || "—";
    counts.set(a, (counts.get(a) || 0) + 1);
  }
  const authors = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  $app.innerHTML = `${topbar()}<h1>👤 Authors</h1>` +
    authors.slice(0, 200).map(([a, n]) =>
      `<a class="card" data-nav href="/author/${encodeURIComponent(a)}">
         <div class="t">${esc(a)}</div><div class="a">${n} books</div></a>`).join("");
}

function viewAuthorBooks(author) {
  const list = BOOKS.filter(b => (b.author || "—") === author);
  $app.innerHTML = `${topbar()}<h1>${esc(author)}</h1>` + resultsHTML("", list);
}

function viewManage() {
  $app.innerHTML = `${topbar()}
    <h1>🛠️ Manage</h1>
    <a class="btn" data-nav href="/add">➕ Add a book</a>
    <a class="btn secondary" data-nav href="/catalog">📍 Record locations</a>
    <a class="btn secondary" href="/api/export">⬇️ Download CSV</a>`;
}

function formFields(b = {}) {
  return `
    <label>Title *</label>
    <input id="f-title" value="${esc(b.title || "")}">
    <label>Hindi title (Devanagari)</label>
    <input id="f-title_hi" value="${esc(b.title_hi || "")}" lang="hi">
    <label>Author</label>
    <input id="f-author" value="${esc(b.author || "")}">
    <label>Publisher</label>
    <input id="f-publisher" value="${esc(b.publisher || "")}">
    <div class="row2"><div>
      <label>Year</label>
      <input id="f-pub_year" inputmode="numeric" value="${esc(b.pub_year || "")}">
    </div><div>
      <label>Language</label>
      <select id="f-language">
        <option ${b.language !== "Hindi" ? "selected" : ""}>English</option>
        <option ${b.language === "Hindi" ? "selected" : ""}>Hindi</option>
      </select>
    </div></div>`;
}

function stepperHTML(idPrefix, label, val) {
  return `<label>${label}</label>
    <div class="stepper">
      <button class="secondary" data-step="${idPrefix}:-1">−</button>
      <div class="val" id="${idPrefix}-val">${val}</div>
      <button class="secondary" data-step="${idPrefix}:1">+</button>
    </div>`;
}
function wireSteppers(root) {
  root.querySelectorAll("[data-step]").forEach(btn => btn.onclick = () => {
    const [prefix, d] = btn.dataset.step.split(":");
    const el = document.getElementById(prefix + "-val");
    el.textContent = Math.max(1, (+el.textContent || 1) + +d);
  });
}

function viewForm(id) {
  const b = id ? BOOKS.find(x => x.id === id) : null;
  if (id && !b) return go("/");
  const c = b?.copies?.[0];
  $app.innerHTML = `${topbar()}
    <h1>${id ? "Edit details" : "➕ New book"}</h1>
    ${formFields(b || {})}
    ${id ? "" : stepperHTML("alm", "Almirah number", stickyAlmirah)
              + stepperHTML("shf", "Shelf number", stickyShelf)}
    <div id="msg"></div>
    <button id="save">Save</button>`;
  wireSteppers($app);
  document.getElementById("save").onclick = async () => {
    const val = f => document.getElementById("f-" + f).value.trim() || null;
    const msg = document.getElementById("msg");
    const payload = {
      title: val("title"), title_hi: val("title_hi"), author: val("author"),
      publisher: val("publisher"),
      pub_year: val("pub_year") ? +val("pub_year") : null,
      language: document.getElementById("f-language").value,
    };
    if (!payload.title) {
      msg.innerHTML = `<div class="strip err">Title is required</div>`;
      return;
    }
    payload.search_text = [payload.title, payload.title_hi, payload.author]
      .filter(Boolean).map(s => s.toLowerCase() + " " + fold(s)).join(" ");
    try {
      if (id) {
        await api(`/api/books/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        payload.almirah_no = stickyAlmirah = +document.getElementById("alm-val").textContent;
        payload.shelf_no = stickyShelf = +document.getElementById("shf-val").textContent;
        await api("/api/books", { method: "POST", body: JSON.stringify(payload) });
      }
      await loadBooks(true);
      msg.innerHTML = `<div class="strip">✅ Saved</div>`;
      if (!id) ["title", "title_hi", "author"].forEach(f =>
        document.getElementById("f-" + f).value = "");
    } catch (e) {
      msg.innerHTML = `<div class="strip err">Could not save — check the internet and try again</div>`;
    }
  };
}

function viewCatalog() {
  const queue = [];
  for (const b of BOOKS)
    for (const c of b.copies || [])
      if (!c.almirah_no) queue.push({ b, c });
  const total = BOOKS.reduce((n, b) => n + (b.copies?.length || 0), 0);
  if (!queue.length) {
    $app.innerHTML = `${topbar()}<h1>📍 Record locations</h1>
      <div class="strip">✅ All done — every book has a location!</div>`;
    return;
  }
  let i = 0;
  const draw = () => {
    const { b, c } = queue[i];
    $app.innerHTML = `${topbar()}
      <div class="count">${i + 1} / ${queue.length} remaining — ${total} copies total</div>
      <h1 style="text-align:left">${esc(b.title_hi || b.title)}</h1>
      <div class="muted">${esc(b.author || "")}${b.copies.length > 1 ? ` · copy ${c.copy_no}` : ""}</div>
      ${stepperHTML("alm", "Almirah number", stickyAlmirah)}
      ${stepperHTML("shf", "Shelf number", stickyShelf)}
      <button id="save">Save & next</button>
      <button id="skip" class="secondary">Skip</button>`;
    wireSteppers($app);
    document.getElementById("save").onclick = async () => {
      stickyAlmirah = +document.getElementById("alm-val").textContent;
      stickyShelf = +document.getElementById("shf-val").textContent;
      await api(`/api/copies/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ almirah_no: stickyAlmirah, shelf_no: stickyShelf }),
      });
      c.almirah_no = stickyAlmirah; c.shelf_no = stickyShelf;
      localStorage.setItem("books_v1", JSON.stringify(BOOKS));
      if (++i < queue.length) draw(); else viewCatalog();
    };
    document.getElementById("skip").onclick = () => { if (++i < queue.length) draw(); else viewCatalog(); };
  };
  draw();
}

/* ---------- boot ---------- */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
render(location.pathname);
