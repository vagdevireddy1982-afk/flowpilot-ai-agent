import { getAIProvider } from "@/lib/ai/providers";
import { chunkSections, type SourceSection } from "@/lib/ai/rag/chunking";
import { getVectorStore } from "@/lib/ai/rag/vector-store";
import { prisma } from "@/lib/db/prisma";
import { validationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const SUPPORTED_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/pdf",
] as const;

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function isSupportedFile(filename: string, mimeType: string): boolean {
  if ((SUPPORTED_MIME_TYPES as readonly string[]).includes(mimeType)) return true;
  return /\.(txt|md|markdown|pdf)$/i.test(filename);
}

/** Extracts text, keeping page boundaries for PDFs so citations can cite pages. */
export async function extractSections(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<SourceSection[]> {
  const isPdf = mimeType === "application/pdf" || /\.pdf$/i.test(filename);

  if (!isPdf) {
    const text = buffer.toString("utf8");
    if (!text.trim()) throw validationError("The uploaded file appears to be empty.");
    return [{ text, page: null }];
  }

  const { extractText, getDocumentProxy } = await import("unpdf");
  const document = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(document, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  const sections = pages
    .map((pageText, index) => ({ text: pageText ?? "", page: index + 1 }))
    .filter((section) => section.text.trim().length > 0);

  if (sections.length === 0) {
    throw validationError(
      "No selectable text was found in that PDF. Scanned documents need OCR before upload.",
    );
  }
  return sections;
}

/**
 * Full ingestion pipeline: extract → chunk → embed → persist → index.
 *
 * Runs inline (documents are small); the status column exists so a queue can
 * be dropped in later without changing the UI contract.
 */
export async function ingestDocument(documentId: string): Promise<{ chunkCount: number }> {
  const document = await prisma.knowledgeDocument.findUnique({ where: { id: documentId } });
  if (!document) throw validationError("Document not found.");

  await prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: { status: "PROCESSING", error: null },
  });

  try {
    const sections: SourceSection[] = document.content
      ? [{ text: document.content, page: null }]
      : [];
    if (sections.length === 0) {
      throw validationError("The document has no extracted text to index.");
    }

    const chunks = chunkSections(sections);
    if (chunks.length === 0) throw validationError("The document produced no indexable chunks.");

    const provider = getAIProvider();
    const embeddings = await provider.generateEmbedding(chunks.map((chunk) => chunk.content));

    await prisma.knowledgeChunk.deleteMany({ where: { documentId } });
    await prisma.knowledgeChunk.createMany({
      data: chunks.map((chunk, index) => ({
        documentId,
        index: chunk.index,
        content: chunk.content,
        page: chunk.page,
        tokenCount: chunk.tokenCount,
        embeddingFallback: embeddings[index] ?? [],
        embeddingModel: provider.embeddingModel,
      })),
    });

    const stored = await prisma.knowledgeChunk.findMany({
      where: { documentId },
      select: { id: true, index: true },
      orderBy: { index: "asc" },
    });

    const store = await getVectorStore();
    await store.upsert(
      stored.map((chunk) => ({
        chunkId: chunk.id,
        embedding: embeddings[chunk.index] ?? [],
      })),
    );

    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "READY", chunkCount: chunks.length, error: null },
    });

    logger.info("rag.document_indexed", {
      documentId,
      chunks: chunks.length,
      store: store.name,
      embeddingModel: provider.embeddingModel,
    });

    return { chunkCount: chunks.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Indexing failed";
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "FAILED", error: message.slice(0, 500) },
    });
    logger.error("rag.ingest_failed", { documentId, error: message });
    throw error;
  }
}

/**
 * Re-embeds every ready document. Needed after switching embedding providers,
 * because vectors from different models are not comparable.
 */
export async function reindexAll(): Promise<{ documents: number; chunks: number }> {
  const documents = await prisma.knowledgeDocument.findMany({ select: { id: true } });
  let chunks = 0;
  for (const document of documents) {
    const result = await ingestDocument(document.id);
    chunks += result.chunkCount;
  }
  return { documents: documents.length, chunks };
}
