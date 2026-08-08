# 📚 Panchvati Library

Our family's home-library app: search ~1,800 books in English and Hindi (typed or
spoken), see exactly which almirah and shelf a book lives on, and manage the
collection from any phone.

**Live app:** https://library-surya.library-surya.workers.dev *(family PIN required)*

Built as a no-build-step PWA on Cloudflare Workers + D1 (SQLite). Runs at $0/month.

## Repo layout

| Path | What it is |
|---|---|
| `revamp/app/` | The deployed app — Worker API, database schema/seed, PWA frontend |
| `revamp/tools/` | Oracle dump parser + data cleaning/migration scripts |
| `revamp/data/` | Extracted catalog CSVs and the migration log |
| `revamp/design/` | Architecture, schema, UX, and AI-features design docs |
| `Data/`, `LibrarySolution.exe`, `Skin/` | Archive of the legacy system (2019 VB6 + Oracle desktop app) |

The catalog was recovered by parsing the legacy system's Oracle export backups
directly — no Oracle install needed. Full status, deploy steps, and local
development instructions: [`revamp/README.md`](revamp/README.md).
