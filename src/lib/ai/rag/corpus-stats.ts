import { tokenize } from "@/lib/ai/providers/mock/embedding";
import { prisma } from "@/lib/db/prisma";

interface CorpusStats {
  documentFrequency: Map<string, number>;
  chunkCount: number;
  loadedAt: number;
}

const TTL_MS = 60_000;
const MAX_CHUNKS = 5000;

let cache: CorpusStats | null = null;

/**
 * Inverse document frequency over knowledge chunks.
 *
 * Without it, a question like "according to our refund policy, can a delivered
 * order be refunded?" matches any chunk containing the very common words
 * "refund" and "policy" just as strongly as the chunk that actually answers it.
 * The corpus is small enough to recompute in-process on a short TTL; a larger
 * deployment would move this to Postgres full-text search.
 */
export async function getCorpusStats(): Promise<CorpusStats> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache;

  const chunks = await prisma.knowledgeChunk.findMany({
    where: { document: { status: "READY" } },
    select: { content: true },
    take: MAX_CHUNKS,
  });

  const documentFrequency = new Map<string, number>();
  for (const chunk of chunks) {
    for (const term of new Set(tokenize(chunk.content))) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  cache = { documentFrequency, chunkCount: chunks.length, loadedAt: Date.now() };
  return cache;
}

export function idf(stats: CorpusStats, term: string): number {
  const frequency = stats.documentFrequency.get(term) ?? 0;
  // Smoothed IDF; unseen terms get the maximum weight so a question about
  // something absent from the corpus cannot be "matched" by its filler words.
  return Math.log((stats.chunkCount + 1) / (frequency + 0.5));
}

export function invalidateCorpusStats(): void {
  cache = null;
}
