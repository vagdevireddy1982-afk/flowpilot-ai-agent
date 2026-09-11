# Retrieval-augmented generation

## Pipeline

```
upload (PDF / Markdown / text)
  └─ extract text            unpdf for PDFs, keeping page boundaries
      └─ chunk               paragraph-aware, ~600 chars, 120-char overlap
          └─ embed           AIProvider.generateEmbedding → 1536 dims
              └─ store       KnowledgeChunk row + pgvector column
                  └─ search  cosine ranking, relevance floor, citations
                      └─ answer    grounded in the retrieved passages only
```

Ingestion is `src/lib/ai/rag/ingest.ts`; retrieval is `retriever.ts`; storage is
`vector-store.ts`.

## Chunking

`chunkSections` splits on paragraph boundaries, falls back to sentence
boundaries for oversized paragraphs, and hard-splits anything still too long.
Each chunk carries a sliding overlap of the previous chunk's tail so a fact that
straddles a boundary appears whole in at least one chunk. PDF chunks keep their
1-based page number, which is what makes "page 3" in a citation true rather than
decorative.

Chunks are deliberately small (~600 characters). Larger chunks retrieve more
reliably but cite imprecisely; at this size a citation points at roughly one
idea.

## Embeddings

`EMBEDDING_DIMENSIONS = 1536`, matching `text-embedding-3-small`, so the same
column works for both providers.

- **OpenAI provider** — real semantic embeddings.
- **Mock provider** — a hashed bag-of-ngrams projection (`providers/mock/embedding.ts`).
  Tokens are lower-cased, stop-worded and crudely stemmed, unigrams and bigrams
  are hashed into four dimensions each with a sign bit, and the vector is
  L2-normalised.

The mock embedding is lexical, not semantic. It is honest about that: it
exercises the entire retrieval path (storage, cosine ranking, thresholds,
citations) deterministically and for free, and it is replaced by real vectors
with one environment variable.

## Vector storage

Two interchangeable implementations behind `VectorStore`:

- **`PgVectorStore`** — the embedding lives in a `vector(1536)` column and
  ranking happens in Postgres via the `<=>` cosine-distance operator. This is
  the production path; it does not pull the corpus into Node.
- **`FallbackVectorStore`** — cosine similarity computed in the application over
  a `Float[]` copy of the same vector. It exists so the app still runs on a
  managed Postgres without the extension.

`VECTOR_STORE=auto` (the default) detects the extension at runtime and picks
one. The duplicate `embeddingFallback` column is the cost of that portability —
about 12 KB per chunk, which at demo scale is nothing and at large scale would
be dropped along with the fallback store.

## Ranking and the relevance floor

Retrieval over-fetches (4× the requested limit), scores, filters by a floor and
then truncates. Under the mock provider two extra steps apply:

1. **IDF-weighted lexical overlap** is blended with the vector score (60/40).
   Hashed embeddings carry genuine collision noise, so an off-topic question can
   otherwise score as high as a real hit. Weighting by inverse document
   frequency means the distinctive words in a question ("delivered", "warranty")
   count for more than the ubiquitous ones ("policy", "order").
2. **A relevance floor** below which nothing is returned at all.

The consequence matters more than the mechanism: asking "what is the capital of
France?" returns *nothing*, and the agent says the knowledge base does not
contain enough information rather than citing an unrelated paragraph. That
behaviour is pinned by `tests/integration/rag.test.ts`.

Real semantic embeddings skip the lexical blend — matching wording the document
does not contain is precisely their job — and use a higher floor.

## Citations

A citation records the document, the chunk id, the page, a trimmed snippet and
the score. Clicking one fetches the chunk **by id** from the database, so a
source can never point at a passage that does not exist. Citations are stored on
the assistant message, which means an old conversation still shows exactly what
it was grounded in.

Nothing fabricates a citation: they are produced from the retrieval result, not
from the model's output.

## Limits

- Scanned PDFs are rejected with a clear message; there is no OCR.
- Ingestion runs inline in the request. The `DocumentStatus` state machine is
  already queue-shaped, so moving it to a worker is a contained change.
- The fallback store scans up to 5,000 chunks per query — fine for a demo
  corpus, not for a large one, which is what pgvector is for.
