import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { retrieveKnowledge } from "@/lib/ai/rag/retriever";
import { getVectorStore, hasPgVector } from "@/lib/ai/rag/vector-store";
import { invalidateCorpusStats } from "@/lib/ai/rag/corpus-stats";
import { prisma } from "@/lib/db/prisma";
import { deleteDocument, searchKnowledge, uploadDocument } from "@/server/services/knowledge-service";
import { createWorld, destroyWorld, testId, type TestWorld } from "./helpers";

const SHIPPING_DOC = [
  "# Shipping SLA",
  "",
  "Express delivery to metro cities takes one working day. Standard delivery to metro cities takes three working days.",
  "",
  "An order is marked delayed when it passes its expected delivery date without a carrier confirmation.",
  "",
  "Address changes are only possible while an order is pending or processing. Once a parcel is with the carrier the address is locked.",
].join("\n");

describe("retrieval-augmented generation", () => {
  let world: TestWorld;
  let shippingDocumentId: string;

  beforeAll(async () => {
    world = await createWorld("ADMIN");
    const uploaded = await uploadDocument({
      filename: `${testId()}-shipping.md`,
      mimeType: "text/markdown",
      title: `${world.prefix} Shipping SLA`,
      buffer: Buffer.from(SHIPPING_DOC, "utf8"),
      uploadedById: world.adminId,
    });
    shippingDocumentId = uploaded.id;
    invalidateCorpusStats();
  });

  afterAll(async () => {
    await prisma.knowledgeDocument.deleteMany({ where: { id: shippingDocumentId } });
    await destroyWorld(world);
  });

  it("indexes an uploaded document into retrievable chunks", async () => {
    const document = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: shippingDocumentId },
      include: { chunks: true },
    });

    expect(document.status).toBe("READY");
    expect(document.chunkCount).toBeGreaterThan(0);
    expect(document.chunks.length).toBe(document.chunkCount);
    for (const chunk of document.chunks) {
      expect(chunk.embeddingFallback.length).toBe(1536);
      expect(chunk.embeddingModel).toBeTruthy();
    }
  });

  it("writes vectors into pgvector when the extension is present", async () => {
    const store = await getVectorStore();
    const available = await hasPgVector();
    expect(store.name).toBe(available ? "pgvector" : "fallback");

    if (available) {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM "KnowledgeChunk" WHERE "documentId" = $1 AND "embedding" IS NOT NULL`,
        shippingDocumentId,
      );
      expect(Number(rows[0]!.count)).toBeGreaterThan(0);
    }
  });

  it("retrieves the passage that answers the question", async () => {
    const result = await retrieveKnowledge("How long does express delivery to a metro city take?", 4);

    expect(result.insufficient).toBe(false);
    expect(result.matches[0]!.content).toMatch(/express delivery/i);
    expect(result.citations[0]!.documentTitle).toContain("Shipping SLA");
    expect(result.citations[0]!.score).toBeGreaterThan(0);
  });

  it("reports insufficient knowledge for an off-topic question", async () => {
    const result = await retrieveKnowledge("Who won the cricket world cup in 2011?", 4);
    expect(result.insufficient).toBe(true);
    expect(result.citations).toHaveLength(0);
  });

  it("produces citations that point at real stored passages", async () => {
    const result = await searchKnowledge("when can a delivery address be changed", 3);
    expect(result.results.length).toBeGreaterThan(0);

    for (const match of result.results) {
      const chunk = await prisma.knowledgeChunk.findUnique({ where: { id: match.chunkId } });
      expect(chunk?.content).toBe(match.content);
    }
  });

  it("removes chunks when the document is deleted", async () => {
    const temporary = await uploadDocument({
      filename: `${testId()}-temp.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from("A temporary note about warranty claims for laptops.", "utf8"),
      uploadedById: world.adminId,
    });

    expect(await prisma.knowledgeChunk.count({ where: { documentId: temporary.id } })).toBeGreaterThan(0);

    await deleteDocument(temporary.id);

    expect(await prisma.knowledgeChunk.count({ where: { documentId: temporary.id } })).toBe(0);
    expect(await prisma.knowledgeDocument.findUnique({ where: { id: temporary.id } })).toBeNull();
  });

  it("rejects an unsupported file type", async () => {
    await expect(
      uploadDocument({
        filename: "malware.exe",
        mimeType: "application/octet-stream",
        buffer: Buffer.from("MZ binary"),
        uploadedById: world.adminId,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects an empty file", async () => {
    await expect(
      uploadDocument({
        filename: "empty.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(""),
        uploadedById: world.adminId,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
