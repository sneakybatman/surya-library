# Home Library App — UX Specification
**Audience:** elderly Hindi-speaking parents (primary), family admins (secondary). Mobile-first (Android Chrome).

---

## 1. Design Principles (binding rules)

1. **One job per screen.** Every screen has exactly one primary action, rendered as one large button. No secondary toolbars.
2. **Type sizes (minimums, not defaults):** body 20px (1.25rem); input text and buttons 22px; book titles in lists 24px; the location answer 40px+. Devanagari needs ~10% more size than Latin at equal legibility — never below 22px for Devanagari body text. Respect OS font scaling (use rem, never px-locked containers).
3. **Touch targets:** minimum 56×56px, 12px+ gaps between targets. Full-width buttons for primary actions. Tappable rows ≥ 72px tall.
4. **Contrast:** WCAG AAA (7:1) for all text; no grey-on-white placeholder-as-label. No text over images. Light theme only — no dark mode toggle.
5. **Everything visible, nothing hidden.** All navigation on screen as labeled buttons. Text labels on every button (icon may accompany, never replace).
6. **No timing-dependent UI.** Nothing appears and disappears on its own.
7. **Forgiveness over confirmation.** Actions are reversible (undo), so no "Are you sure?" dialogs.
8. **BANNED patterns:** hamburger/kebab menus, swipe gestures of any kind, long-press, toasts/snackbars that auto-dismiss, modals/bottom sheets, carousels, tabs, pull-to-refresh, infinite scroll, floating action buttons, icon-only buttons, hover-dependent anything, multi-select, drag-and-drop.

---

## 2. Information Architecture

**Navigation model:** Home is the search screen. Maximum depth = 2 taps from Home to any answer. Every non-Home screen has one large **"⌂ मुख्य पृष्ठ / Home"** button fixed at top-left plus the browser back button working correctly (real URLs, no state traps).

**Screens (complete list):**

| # | Screen | Reached from |
|---|--------|--------------|
| 1 | Home / Search | app URL (bookmark on home screen) |
| 2 | Search Results | typing on Home |
| 3 | Book Detail (with location) | tapping a result |
| 4 | Browse Authors (A–Z + अ–ज्ञ list) | Home button |
| 5 | Browse Subjects (fixed list of ~15) | Home button |
| 6 | Author's / Subject's books | Browse screens (reuses Results layout) |
| 7 | Add Book (admin) | small "प्रबंधन / Manage" link at Home footer |
| 8 | Edit Book (admin) | link on Book Detail |

No login for reading. "Manage" screens sit behind a single shared family PIN (remembered per device) — enough for a family app, zero friction for parents who never go there.

**How search-first?** Maximally. The keyboard-focusable search box occupies the top third of Home; Browse buttons exist because some elderly users prefer recognition (tapping an author name) over recall (typing). Both paths lead to the same Results screen.

---

## 3. Key Screen Specs

### 3a. Home / Search

```
┌──────────────────────────────┐
│      📚 हमारी लाइब्रेरी        │  ← App title, decorative only
│                              │
│ ┌──────────────────────────┐ │
│ │ 🔍 किताब या लेखक लिखें…   │ │  ← 60px tall input, 22px text.
│ └──────────────────────────┘ │    Label ABOVE stays when typing.
│ ┌──────────┐  ┌───────────┐  │
│ │ 🎤 बोलकर  │  │  खोजें     │  │  ← Mic button (voice search) +
│ │  खोजें    │  │  Search   │  │    explicit Search button, 56px+
│ └──────────┘  └───────────┘  │
│                              │
│ ┌──────────────────────────┐ │
│ │ 👤 लेखक से देखें / Authors │ │  ← Full-width, 64px tall
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ 📖 विषय से देखें / Subjects│ │
│ └──────────────────────────┘ │
│                              │
│        प्रबंधन / Manage       │  ← Small text link, admin only
└──────────────────────────────┘
```
**Annotations:** No other content — no "recently added", no stats. Results appear live below the box as the user types (see §4), but the Search button also exists because elderly users expect to press something. Mic starts Hindi voice recognition immediately, shows a pulsing "बोलिए… / Speak now" state.

### 3b. Search Results

```
┌──────────────────────────────┐
│ ⌂ मुख्य पृष्ठ    🔍 gaban     │  ← Query stays visible & editable
│ 3 किताबें मिलीं / 3 found     │  ← Result count in words
│ ┌──────────────────────────┐ │
│ │ गबन (GABAN)          24px│ │  ← Title: Devanagari first,
│ │ प्रेमचंद · Premchand      │ │    transliteration in brackets
│ │ 🟢 उपलब्ध · अलमारी 4     │ │  ← Availability + almirah ON THE
│ └──────────────────────────┘ │    CARD — many searches end here
│ ┌──────────────────────────┐ │
│ │ ग़बन और अन्य कहानियाँ      │ │  ← Whole card is one tap target,
│ │ प्रेमचंद                  │ │    ≥96px tall, clear border
│ │ 🔴 बाहर गई है · अलमारी 4  │ │
│ └──────────────────────────┘ │
│ ┌────────── और देखें ───────┐ │  ← "Show more" button; page size
│ └──────────────────────────┘ │    10; never infinite scroll
└──────────────────────────────┘
```
**Annotations:** Sort by match quality then title. Green/red status uses filled dot + words (never color alone). Card tap → Book Detail.

### 3c. Book Detail — the location treatment

```
┌──────────────────────────────┐
│ ⌂ मुख्य पृष्ठ / Home          │
│                              │
│  गबन                    32px │
│  GABAN                       │
│  लेखक: प्रेमचंद (Premchand)   │
│                              │
│ ╔══════════════════════════╗ │
│ ║   यह किताब यहाँ है:        ║ │  ← "This book is here:"
│ ║                          ║ │
│ ║   अलमारी ४   शेल्फ़ २      ║ │  ← 44px bold, dark text on
│ ║   Almirah 4 · Shelf 2    ║ │    saturated yellow panel,
│ ╚══════════════════════════╝ │    full-width, unmissable
│                              │
│  🟢 उपलब्ध है / Available     │  ← Status line, 24px
│                              │
│ ┌──────────────────────────┐ │
│ │ 📕 किताब निकाली / Take out │ │  ← One big state-toggle button
│ └──────────────────────────┘ │    (see 3e)
│  विषय: उपन्यास / Novel        │
│  विवरण बदलें / Edit  (admin)  │  ← small link
└──────────────────────────────┘
```
**Annotations:** Location panel is first content after the title — visible without scrolling on a 360px phone. Numbers shown in both Devanagari and Arabic numerals. If issued: panel stays (book belongs there) but status reads "🔴 बाहर गई है — राहुल ने ली है (12 जुलाई से)" (who took it, since when).

### 3d. Add Book (admin flow)

One field-group per step, big **आगे / Next** button. Steps: ① ISBN scan (optional) → ② Title → ③ Author → ④ Subject → ⑤ Location → ⑥ Review & Save.

```
Step ① (optional)                Step ⑤ Location
┌───────────────────────┐       ┌───────────────────────┐
│ 📷 बारकोड स्कैन करें    │       │ अलमारी नंबर / Almirah  │
│ ┌───────────────────┐ │       │  ┌───┐ ┌────┐ ┌───┐   │
│ │  [camera view]    │ │       │  │ − │ │ 4  │ │ + │   │ ← Stepper,
│ └───────────────────┘ │       │  └───┘ └────┘ └───┘   │   56px keys
│ ┌───────────────────┐ │       │ शेल्फ़ नंबर / Shelf     │
│ │ बिना स्कैन आगे बढ़ें │ │       │  ┌───┐ ┌────┐ ┌───┐   │
│ │ Skip — type it in │ │       │  │ − │ │ 2  │ │ + │   │
│ └───────────────────┘ │       │  └───┘ └────┘ └───┘   │
└───────────────────────┘       │ [ आगे / Next ]         │
                                └───────────────────────┘
```
**Annotations:** Use the Chrome `BarcodeDetector` API (native on Android Chrome; feature-detect and hide the scan step if absent). On scan hit, prefill title/author from Open Library/Google Books — but treat scan as a bonus: most older Hindi books have no ISBN or no lookup record, so manual entry is the primary path and must be excellent. Title step offers a Hindi transliteration keyboard toggle (type "gaban" → suggest "गबन"); store both scripts. Author and Subject steps autocomplete from existing values to prevent duplicates ("PREMCHAND" vs "PREMCHANDRA"). Review step shows everything, **सेव करें / Save** is the only big button.

### 3e. Mark Taken / Returned

On Book Detail, one toggle button. Tap "किताब निकाली / Take out" →

```
┌──────────────────────────────┐
│ ✅ दर्ज हो गया — किताब बाहर    │  ← Inline confirmation strip
│    गई है / Marked as taken   │    replaces the button area.
│ ┌────────────────────────┐   │    PERSISTS (no auto-dismiss)
│ │ गलती से हुआ? वापस करें    │   │ ← Undo button, one tap,
│ │ Undo                   │   │    reverts silently
│ └────────────────────────┘   │
│ किसने ली? / Who took it?      │
│ [पापा] [मम्मी] [राहुल] [अन्य]  │  ← Optional big chips; default
└──────────────────────────────┘    "परिवार / Family" if skipped
```
**Annotations:** No confirm dialog before, no borrower form blocking the action — record first, refine optionally. Date auto-captured. When issued, the button reads "📗 किताब वापस रखी / Mark returned" and the strip reminds where to put it: "अलमारी 4, शेल्फ़ 2 पर रखें".

---

## 4. Search UX

- **Matching (in priority order):** (1) case/diacritic-insensitive substring on title, transliterated title, and author; (2) transliteration normalization — collapse doubled vowels (`gabaan→gaban`), equate `ph/f`, `v/w`, `sh/s`, `d/dh`, `t/th`, trailing `a` optional (`premchand~premchandra`); implement by normalizing both index and query to a canonical skeleton; (3) trigram/edit-distance ≤2 fuzzy fallback. With 2,000 rows, do all of this client-side or in SQLite — no search service.
- **Script bridging:** index every book under Latin and Devanagari forms; transliterate the query both directions so "गबन" finds "GABAN" and vice versa.
- **Instant + button:** debounce 300ms, show live results after 2 characters, but keep the visible **खोजें / Search** button (it just scrolls to results). Never auto-navigate.
- **Zero results:** never a blank screen. Show, in this order: "'gabban' नाम की कोई किताब नहीं मिली" → up to 3 fuzzy "क्या आपका मतलब गबन था?" suggestion buttons → "लेखक से देखें / Browse authors" button. No sad-face illustrations, no jargon.
- **Voice input:** Web Speech API (`SpeechRecognition`, `lang: "hi-IN"`) works well on Android Chrome and returns Devanagari text — ideal for this audience, who speak faster than they type. Ship the mic button on Home at launch; on browsers without support, hide it. Show the recognized text in the search box so the user sees what was heard and can retry.

---

## 5. Language Strategy

**Bilingual, Hindi-dominant, no toggle.** Every label: Devanagari first at full size, English beneath/beside at ~75% size, grey-but-AAA-contrast. Rationale: parents read Hindi comfortably; English echoes help family members and disambiguate; a language toggle is a setting elderly users will trip on and be unable to reverse. Book data: show Devanagari title as primary once backfilled, transliteration in parentheses (aids family members who know books by "GABAN"). Numerals: Devanagari + Arabic in the location panel, Arabic elsewhere. Dates in Hindi words ("12 जुलाई 2026"), never `08/07/26`.

---

## 6. Errors & Edge Handling

- **Tone:** plain Hindi, say what happened and what to do, never codes. Offline: "इंटरनेट नहीं चल रहा है। थोड़ी देर में फिर कोशिश करें। [फिर से कोशिश करें]" with a retry button. Build as a PWA with cached catalog so search still works offline — the #1 use case shouldn't need the network.
- **Undo, not confirm:** all state changes (taken/returned, edits) apply immediately with a persistent inline undo strip (§3e). Deleting a book (admin only) = "hide" with undo from an admin list; never hard delete.
- **Validation:** inline, next to the field, in red text + icon, in Hindi ("किताब का नाम लिखना ज़रूरी है"); never blocking alerts. Only title is mandatory when adding.
- **Missing data:** book without location shows the yellow panel with "जगह दर्ज नहीं है — घरवालों से पूछें" instead of blank. *(Note: after migration ALL books start without location — see README; the panel copy matters on day one.)*
- **Fat-finger safety:** back button always works; nothing destructive is one accidental tap away except taken/returned, which undo covers.

---

## 7. What NOT to Build

- User accounts, roles, per-person logins (one family PIN for Manage is enough)
- Due dates, fines, reservations, borrowing "policies"
- Ratings, reviews, reading lists, recommendations, social anything
- Book cover images as required content (slow, mostly unavailable for old Hindi books; optional thumbnail only)
- Filters/facets/advanced-search panel (fuzzy single-box search over 2,000 books makes them unnecessary)
- Dark mode, themes, settings screen of any kind
- Notifications/emails, onboarding tours, tooltips
- Barcode-labeling of the physical books themselves (process burden nobody will maintain)
- Native app / Play Store distribution — a bookmarked PWA icon on the home screen is the whole install story
