# AI Features Roadmap — Voice, Synopsis Search, Recommendations

Three features requested on top of the MVP. The first is already shipped; the other
two share one new API endpoint and are designed here so they slot into the
existing Cloudflare Worker with no architecture change.

## 1. Speech-to-text search — ✅ already in the MVP

The home screen's 🎤 button uses the browser's Web Speech API (`SpeechRecognition`,
`lang: "hi-IN"`), which works well on Android Chrome — the family's main platform.
A parent taps the mic, says "गबन" or "प्रेमचंद की किताबें", the recognized Devanagari
text lands in the search box, and the transliteration-folding search matches it
against the Latin-script catalog. No server, no API cost, works today.

## 2 & 3. "Describe a book" + recommendations — one endpoint, two prompts

Both features are the same shape: free-text from the user (spoken or typed, Hindi or
English) → Claude reads it against our catalog → structured answer. So they share a
single new Worker route:

```
POST /api/ask   { mode: "find" | "recommend", query: "..." }
```

- **find** — "उस किताब का नाम भूल गया… गाँव की कहानी है, एक किसान कर्ज़ में डूब जाता है"
  → Claude identifies likely matches from OUR library (that's Godan!) → app shows
  the normal book cards with almirah/shelf location.
- **recommend** — "मुझे प्रेमचंद जैसी सामाजिक कहानियाँ पसंद हैं, कुछ नया सुझाओ"
  → Claude returns (a) books from our library to read next, and (b) 2–3 books NOT
  in our library, each with an Amazon India search link to buy it.

### Why this works without any vector database

At 1,815 books, the entire catalog (id | title | author | language | year, one line
per book) is roughly 100 KB ≈ 30–40K tokens — it simply fits in the model's context.
No embeddings, no RAG pipeline, no index to keep in sync. We send the catalog with a
**prompt-cache breakpoint** (`cache_control: {type: "ephemeral", ttl: "1h"}`) so
repeat questions within the hour read it at ~10% of the input price.

### Worker implementation sketch

API key lives in a Worker secret (`wrangler secret put ANTHROPIC_API_KEY`) — never
in the browser. The route sits behind the same family-PIN cookie as everything else,
plus a small daily cap (e.g. 200 calls/day) as a cost fuse.

```js
import Anthropic from "@anthropic-ai/sdk";   // fetch-based; runs on Workers as-is

const MATCH_SCHEMA = {
  type: "object",
  properties: {
    matches: {                       // books from OUR catalog
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },   // book.id from the catalog listing
          reason: { type: "string" } // one short Hindi sentence
        },
        required: ["id", "reason"], additionalProperties: false
      }
    },
    outside_suggestions: {           // recommend mode only; else empty
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" }, author: { type: "string" },
          reason: { type: "string" }
        },
        required: ["title", "author", "reason"], additionalProperties: false
      }
    }
  },
  required: ["matches", "outside_suggestions"], additionalProperties: false
};

async function ask(env, mode, query, catalogText) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 2000,
    system: [
      { type: "text", text: SYSTEM_PROMPTS[mode] },   // stable, cacheable
      { type: "text", text: catalogText,               // ~35K tokens, cached 1h
        cache_control: { type: "ephemeral", ttl: "1h" } },
    ],
    messages: [{ role: "user", content: query }],
    output_config: { format: { type: "json_schema", schema: MATCH_SCHEMA } },
  });
  if (response.stop_reason === "refusal") return { matches: [], outside_suggestions: [] };
  return JSON.parse(response.content.find(b => b.type === "text").text);
}
```

The frontend maps `matches[].id` to the already-loaded catalog and renders the
standard cards (tap → the yellow location panel). `outside_suggestions` render as
cards with a **"Amazon पर देखें"** button linking to
`https://www.amazon.in/s?k=<title>+<author>` — a search link needs no product IDs
or affiliate setup and never goes stale.

Hindi input needs nothing special: the model reads Devanagari natively, and the
prompt instructs it to answer `reason` fields in simple Hindi so parents can read
why each book was suggested.

### Model choice & cost

Prices are per million tokens. Assume ~35K catalog tokens per call (cached after
the first call each hour) + small query/answer.

| Model | Price (in/out) | First call in an hour | Cached calls | 100 calls/month ≈ |
|---|---|---|---|---|
| **`claude-opus-5`** (recommended) | $5 / $25 | ~$0.22 | ~$0.03 | **$3–6** |
| `claude-haiku-4-5` (the "small LLM" option) | $1 / $5 | ~$0.05 | ~$0.01 | <$1.50 |

Recommendation: start with **`claude-opus-5`** — recommendation quality and Hindi
literary knowledge are the product here, and family-scale volume keeps it a
few dollars a month. If cost ever matters, swapping the model string to
`claude-haiku-4-5` is a one-line change (it matches the "small LLM" idea and is
still strong at this task size).

### Build order

1. **Phase 2a** (after MVP is live): `/api/ask` in `find` mode + a "किताब ढूँढने में
   मदद / Help me find a book" button on the zero-results screen — that's where the
   feature earns its keep for elderly users whose description doesn't match a title.
2. **Phase 2b**: `recommend` mode + a "क्या पढ़ूँ? / What should I read?" button on
   the home screen, with Amazon links on outside suggestions.
3. **Later polish**: language column cleanup in the catalog improves both modes'
   context quality; add `subject` tags as they get filled in.
