import { extractSections, ingestDocument, isSupportedFile, MAX_UPLOAD_BYTES } from "@/lib/ai/rag/ingest";
import { retrieveKnowledge } from "@/lib/ai/rag/retriever";
import { prisma } from "@/lib/db/prisma";
import { notFound, validationError } from "@/lib/errors";

export async function listDocuments() {
  return prisma.knowledgeDocument.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      status: true,
      chunkCount: true,
      error: true,
      createdAt: true,
      updatedAt: true,
      uploadedBy: { select: { id: true, name: true } },
    },
  });
}

export async function getDocument(id: string) {
  const document = await prisma.knowledgeDocument.findUnique({
    where: { id },
    include: {
      uploadedBy: { select: { id: true, name: true } },
      chunks: {
        orderBy: { index: "asc" },
        select: { id: true, index: true, content: true, page: true, tokenCount: true },
      },
    },
  });
  if (!document) throw notFound("Document", id);
  return document;
}

export async function getChunk(chunkId: string) {
  const chunk = await prisma.knowledgeChunk.findUnique({
    where: { id: chunkId },
    select: {
      id: true,
      index: true,
      content: true,
      page: true,
      document: { select: { id: true, title: true, filename: true } },
    },
  });
  if (!chunk) throw notFound("Passage", chunkId);
  return chunk;
}

export interface UploadInput {
  filename: string;
  mimeType: string;
  title?: string;
  buffer: Buffer;
  uploadedById: string;
}

export async function uploadDocument(input: UploadInput) {
  if (input.buffer.byteLength === 0) throw validationError("The uploaded file is empty.");
  if (input.buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw validationError(
      `Files must be smaller than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
    );
  }
  if (!isSupportedFile(input.filename, input.mimeType)) {
    throw validationError("Only PDF, Markdown and plain-text files can be indexed.");
  }

  const sections = await extractSections(input.buffer, input.filename, input.mimeType);
  const content = sections
    .map((section) => (section.page ? `\n\n[page ${section.page}]\n${section.text}` : section.text))
    .join("\n\n");

  const document = await prisma.knowledgeDocument.create({
    data: {
      title: input.title?.trim() || input.filename.replace(/\.[^.]+$/, ""),
      filename: input.filename,
      mimeType: input.mimeType || "text/plain",
      sizeBytes: input.buffer.byteLength,
      status: "PENDING",
      content,
      uploadedById: input.uploadedById,
    },
  });

  await ingestDocument(document.id);
  return prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: document.id } });
}

export async function deleteDocument(id: string) {
  const document = await prisma.knowledgeDocument.findUnique({ where: { id } });
  if (!document) throw notFound("Document", id);
  await prisma.knowledgeDocument.delete({ where: { id } });
  return { id, title: document.title };
}

export async function searchKnowledge(query: string, limit = 6) {
  const { matches, insufficient, store } = await retrieveKnowledge(query, limit);
  return {
    query,
    insufficient,
    store,
    results: matches.map((match) => ({
      chunkId: match.chunkId,
      documentId: match.documentId,
      documentTitle: match.documentTitle,
      page: match.page,
      score: Number(match.score.toFixed(4)),
      content: match.content,
    })),
  };
}

export async function knowledgeStats() {
  const [documents, chunks, ready] = await Promise.all([
    prisma.knowledgeDocument.count(),
    prisma.knowledgeChunk.count(),
    prisma.knowledgeDocument.count({ where: { status: "READY" } }),
  ]);
  return { documents, chunks, ready };
}
