import { cosineSimilarity } from "@/lib/ai/providers/mock/embedding";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export interface VectorRecord {
  chunkId: string;
  embedding: number[];
}

export interface VectorMatch {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  page: number | null;
  score: number;
}

export interface VectorStore {
  readonly name: string;
  /** Attaches embeddings to chunk rows that already exist. */
  upsert(records: VectorRecord[]): Promise<void>;
  search(embedding: number[], limit: number): Promise<VectorMatch[]>;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.map((value) => value.toFixed(6)).join(",")}]`;
}

/**
 * Production path: similarity is computed by Postgres using pgvector's cosine
 * distance operator, so ranking never pulls the corpus into Node memory.
 */
export class PgVectorStore implements VectorStore {
  readonly name = "pgvector";

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) {
      await prisma.$executeRawUnsafe(
        `UPDATE "KnowledgeChunk" SET "embedding" = $1::vector WHERE "id" = $2`,
        toVectorLiteral(record.embedding),
        record.chunkId,
      );
    }
  }

  async search(embedding: number[], limit: number): Promise<VectorMatch[]> {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        chunkId: string;
        documentId: string;
        documentTitle: string;
        chunkIndex: number;
        content: string;
        page: number | null;
        score: number;
      }>
    >(
      `SELECT c."id" AS "chunkId",
              c."documentId" AS "documentId",
              d."title" AS "documentTitle",
              c."index" AS "chunkIndex",
              c."content" AS "content",
              c."page" AS "page",
              1 - (c."embedding" <=> $1::vector) AS "score"
         FROM "KnowledgeChunk" c
         JOIN "KnowledgeDocument" d ON d."id" = c."documentId"
        WHERE c."embedding" IS NOT NULL
          AND d."status" = 'READY'
        ORDER BY c."embedding" <=> $1::vector
        LIMIT $2`,
      toVectorLiteral(embedding),
      limit,
    );
    return rows.map((row) => ({ ...row, score: Number(row.score) }));
  }
}

/**
 * Portable path for Postgres instances without the pgvector extension. Cosine
 * similarity is computed in the application over the `embeddingFallback`
 * column. Fine for the demo corpus; the pgvector store is what scales.
 */
export class FallbackVectorStore implements VectorStore {
  readonly name = "fallback";
  private static readonly MAX_SCAN = 5000;

  async upsert(): Promise<void> {
    // Embeddings are already written to `embeddingFallback` by the ingestion
    // pipeline, so there is nothing extra to persist here.
  }

  async search(embedding: number[], limit: number): Promise<VectorMatch[]> {
    const chunks = await prisma.knowledgeChunk.findMany({
      where: { document: { status: "READY" } },
      select: {
        id: true,
        documentId: true,
        index: true,
        content: true,
        page: true,
        embeddingFallback: true,
        document: { select: { title: true } },
      },
      take: FallbackVectorStore.MAX_SCAN,
    });

    return chunks
      .map((chunk) => ({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentTitle: chunk.document.title,
        chunkIndex: chunk.index,
        content: chunk.content,
        page: chunk.page,
        score: cosineSimilarity(embedding, chunk.embeddingFallback),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

let cachedStore: VectorStore | null = null;

export async function hasPgVector(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM pg_extension WHERE extname = 'vector'
    `;
    return Number(rows[0]?.count ?? 0) > 0;
  } catch (error) {
    logger.warn("vector.detection_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function getVectorStore(): Promise<VectorStore> {
  if (cachedStore) return cachedStore;

  if (env.VECTOR_STORE === "pgvector") cachedStore = new PgVectorStore();
  else if (env.VECTOR_STORE === "fallback") cachedStore = new FallbackVectorStore();
  else cachedStore = (await hasPgVector()) ? new PgVectorStore() : new FallbackVectorStore();

  logger.info("vector.store_selected", { store: cachedStore.name, mode: env.VECTOR_STORE });
  return cachedStore;
}

export function resetVectorStore(): void {
  cachedStore = null;
}
