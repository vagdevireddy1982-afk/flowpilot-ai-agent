import { getAIProvider } from "@/lib/ai/providers";
import { tokenize } from "@/lib/ai/providers/mock/embedding";
import { getCorpusStats, idf } from "@/lib/ai/rag/corpus-stats";
import { getVectorStore, type VectorMatch } from "@/lib/ai/rag/vector-store";
import { logger } from "@/lib/logger";
import type { Citation } from "@/types/agent";

/**
 * Similarity floor below which a match is treated as "not actually relevant".
 * The hashed demo embeddings and real semantic embeddings live on different
 * scales, so the floor is provider-specific.
 */
const MIN_SCORE: Record<string, number> = {
  mock: 0.18,
  openai: 0.24,
};

/**
 * Weight of literal term overlap in the final ranking.
 *
 * Applied only to the offline mock embeddings: their similarity scores carry
 * real hash-collision noise, so an off-topic question ("what is the capital of
 * France?") can otherwise score as high as a genuine hit. Blending in lexical
 * overlap makes the relevance floor meaningful and is a standard hybrid-search
 * technique. Real semantic embeddings are used on their own, because there the
 * whole point is matching wording the document does not contain.
 */
const LEXICAL_WEIGHT = 0.6;

const SNIPPET_CHARS = 320;

export interface RetrievalResult {
  matches: VectorMatch[];
  citations: Citation[];
  /** True when the corpus had nothing above the relevance floor. */
  insufficient: boolean;
  store: string;
}

export async function retrieveKnowledge(
  query: string,
  limit = 4,
): Promise<RetrievalResult> {
  const provider = getAIProvider();
  const store = await getVectorStore();

  const [embedding] = await provider.generateEmbedding([query]);
  if (!embedding) {
    return { matches: [], citations: [], insufficient: true, store: store.name };
  }

  // Over-fetch, then filter by score: a fixed LIMIT alone would happily return
  // four irrelevant chunks for an off-topic question.
  const raw = await store.search(embedding, Math.max(limit * 4, 16));
  const floor = MIN_SCORE[provider.name] ?? 0.2;
  const stats = provider.name === "mock" ? await getCorpusStats() : null;
  const scored = stats ? raw.map((match) => rescoreLexically(query, match, stats)) : raw;
  const relevant = scored
    .filter((match) => match.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  logger.debug("rag.retrieve", {
    query: query.slice(0, 120),
    candidates: raw.length,
    kept: relevant.length,
    topScore: raw[0]?.score ?? 0,
    store: store.name,
  });

  return {
    matches: relevant,
    citations: relevant.map(toCitation),
    insufficient: relevant.length === 0,
    store: store.name,
  };
}

/** Blends vector similarity with IDF-weighted overlap of the question's terms. */
function rescoreLexically(
  query: string,
  match: VectorMatch,
  stats: Awaited<ReturnType<typeof getCorpusStats>>,
): VectorMatch {
  const queryTerms = new Set(tokenize(query));
  if (queryTerms.size === 0) return match;

  const chunkTerms = new Set(tokenize(match.content));
  let matched = 0;
  let total = 0;
  for (const term of queryTerms) {
    const weight = idf(stats, term);
    total += weight;
    if (chunkTerms.has(term)) matched += weight;
  }

  const overlap = total > 0 ? matched / total : 0;
  return { ...match, score: LEXICAL_WEIGHT * overlap + (1 - LEXICAL_WEIGHT) * match.score };
}

function toCitation(match: VectorMatch): Citation {
  return {
    documentId: match.documentId,
    documentTitle: match.documentTitle,
    chunkId: match.chunkId,
    page: match.page,
    snippet: snippet(match.content),
    score: Number(match.score.toFixed(4)),
  };
}

function snippet(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= SNIPPET_CHARS) return normalized;
  const cut = normalized.lastIndexOf(" ", SNIPPET_CHARS);
  return `${normalized.slice(0, cut > 0 ? cut : SNIPPET_CHARS)}…`;
}

/** Formats retrieved passages for injection into the model's context window. */
export function buildKnowledgeContext(matches: VectorMatch[]): string {
  if (matches.length === 0) return "";
  return matches
    .map(
      (match, index) =>
        `[${index + 1}] ${match.documentTitle}${match.page ? ` (page ${match.page})` : ""}\n${match.content}`,
    )
    .join("\n\n");
}
