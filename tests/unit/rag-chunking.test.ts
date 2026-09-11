import { describe, expect, it } from "vitest";
import { chunkSections, chunkText } from "@/lib/ai/rag/chunking";
import { cosineSimilarity, embedText, stem, tokenize } from "@/lib/ai/providers/mock/embedding";
import { EMBEDDING_DIMENSIONS } from "@/lib/ai/provider";

const PARAGRAPH = (word: string, times: number) => `${word} `.repeat(times).trim();

describe("chunking", () => {
  it("keeps a short document as a single chunk", () => {
    const chunks = chunkText("A short policy statement about refunds within thirty days.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.index).toBe(0);
    expect(chunks[0]!.page).toBeNull();
  });

  it("splits a long document and numbers chunks sequentially", () => {
    const text = [PARAGRAPH("alpha", 120), PARAGRAPH("beta", 120), PARAGRAPH("gamma", 120)].join(
      "\n\n",
    );
    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, index) => index));
    for (const chunk of chunks) {
      // Overlap can push a chunk slightly past the target, but not wildly.
      expect(chunk.content.length).toBeLessThan(1400);
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });

  it("overlaps consecutive chunks so a fact on the boundary survives", () => {
    const text = `${PARAGRAPH("alpha", 100)}\n\nRefunds are processed within seven working days.\n\n${PARAGRAPH("beta", 100)}`;
    const chunks = chunkText(text, { maxChars: 400, overlapChars: 120 });
    const joined = chunks.map((chunk) => chunk.content).join(" ");
    expect(joined).toContain("Refunds are processed within seven working days.");
  });

  it("preserves page numbers from paged sources", () => {
    const chunks = chunkSections([
      { text: PARAGRAPH("page one content", 40), page: 1 },
      { text: PARAGRAPH("page two content", 40), page: 2 },
    ]);
    expect(chunks.some((chunk) => chunk.page === 1)).toBe(true);
    expect(chunks.some((chunk) => chunk.page === 2)).toBe(true);
  });

  it("never emits an empty chunk", () => {
    const chunks = chunkText("\n\n   \n\nSomething real.\n\n\n");
    expect(chunks.every((chunk) => chunk.content.trim().length > 0)).toBe(true);
  });

  it("starts a new chunk at a markdown heading", () => {
    const text = [
      "## Refund window",
      PARAGRAPH("refund", 30),
      "## Delivery delays",
      PARAGRAPH("delivery", 30),
    ].join("\n\n");
    const chunks = chunkText(text);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.content).toContain("## Refund window");
    expect(chunks[0]!.content).not.toContain("## Delivery delays");
    expect(chunks[1]!.content).toContain("## Delivery delays");
  });

  it("repeats the heading on every chunk of a section too long for one", () => {
    const text = ["## Approval thresholds", PARAGRAPH("threshold", 300)].join("\n\n");
    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content).toContain("## Approval thresholds");
    }
  });

  it("packs a section too small to stand alone with the next one", () => {
    const text = ["## Scope", "Applies to all orders.", "## Detail", PARAGRAPH("detail", 30)].join(
      "\n\n",
    );
    const chunks = chunkText(text);

    expect(chunks[0]!.content).toContain("## Scope");
    expect(chunks[0]!.content).toContain("## Detail");
  });

  it("hard-splits a single oversized paragraph", () => {
    const chunks = chunkText(PARAGRAPH("word", 500), { maxChars: 300 });
    expect(chunks.length).toBeGreaterThan(3);
  });
});

describe("deterministic embeddings", () => {
  it("produces a normalised vector of the configured dimension", () => {
    const vector = embedText("refund policy for delivered orders");
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("is deterministic across calls", () => {
    expect(embedText("same text")).toEqual(embedText("same text"));
  });

  it("scores related text above unrelated text", () => {
    const query = embedText("how long is the warranty on electronics");
    const related = embedText(
      "All electronics carry a 12-month manufacturer warranty from the delivery date.",
    );
    const unrelated = embedText("Carriers make three delivery attempts before returning a parcel.");
    expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated));
  });

  it("returns a zero vector for empty input rather than throwing", () => {
    const vector = embedText("   ");
    expect(vector.every((value) => value === 0)).toBe(true);
    expect(cosineSimilarity(vector, embedText("anything"))).toBe(0);
  });

  it("stems inflections onto a shared token", () => {
    expect(stem("deliveries")).toBe(stem("delivery"));
    expect(stem("conversations")).toBe(stem("conversation"));
    expect(tokenize("What is the refund policy?")).not.toContain("what");
  });
});
