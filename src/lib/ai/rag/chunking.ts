import { estimateTokens } from "@/lib/ai/provider";

export interface SourceSection {
  text: string;
  /** 1-based page number for PDFs; null for plain text and markdown. */
  page: number | null;
}

export interface TextChunk {
  index: number;
  content: string;
  page: number | null;
  tokenCount: number;
}

export interface ChunkOptions {
  /** Target chunk size in characters. */
  maxChars?: number;
  /** Characters of trailing context repeated at the start of the next chunk. */
  overlapChars?: number;
  minChars?: number;
}

const DEFAULTS: Required<ChunkOptions> = {
  // Small enough that a retrieved chunk is mostly *about* one thing (which
  // matters for citation precision), large enough to keep a clause intact.
  maxChars: 600,
  overlapChars: 120,
  minChars: 60,
};

function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function overlapFrom(text: string, overlapChars: number): string {
  if (overlapChars <= 0 || text.length <= overlapChars) return "";
  const tail = text.slice(-overlapChars);
  const boundary = tail.search(/[.!?]\s|\n/);
  return boundary === -1 ? tail : tail.slice(boundary + 1).trim();
}

/**
 * Paragraph-aware splitter with sentence fallback and a sliding overlap so a
 * fact that straddles a boundary still appears whole in at least one chunk.
 */
export function chunkSections(
  sections: SourceSection[],
  options: ChunkOptions = {},
): TextChunk[] {
  const { maxChars, overlapChars, minChars } = { ...DEFAULTS, ...options };
  const chunks: TextChunk[] = [];
  let index = 0;

  for (const section of sections) {
    const normalized = section.text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
    if (!normalized) continue;

    const blocks = normalized.split(/\n\s*\n+/).flatMap((paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed) return [];
      return trimmed.length <= maxChars ? [trimmed] : splitSentences(trimmed);
    });

    let buffer = "";
    const flush = () => {
      const content = buffer.trim();
      if (content.length >= minChars || (content.length > 0 && chunks.length === 0)) {
        chunks.push({
          index: index++,
          content,
          page: section.page,
          tokenCount: estimateTokens(content),
        });
      } else if (content.length > 0 && chunks.length > 0) {
        // Merge a tiny trailing fragment into the previous chunk.
        const previous = chunks[chunks.length - 1]!;
        previous.content = `${previous.content}\n${content}`;
        previous.tokenCount = estimateTokens(previous.content);
      }
      buffer = "";
    };

    for (const block of blocks) {
      const candidate = buffer ? `${buffer}\n\n${block}` : block;
      if (candidate.length > maxChars && buffer) {
        const carry = overlapFrom(buffer, overlapChars);
        flush();
        buffer = carry ? `${carry}\n\n${block}` : block;
      } else if (candidate.length > maxChars) {
        // A single oversized block: hard-split it.
        let rest = candidate;
        while (rest.length > maxChars) {
          const slicePoint = rest.lastIndexOf(" ", maxChars);
          const cut = slicePoint > maxChars * 0.6 ? slicePoint : maxChars;
          buffer = rest.slice(0, cut);
          const carry = overlapFrom(buffer, overlapChars);
          flush();
          rest = carry ? `${carry} ${rest.slice(cut).trim()}` : rest.slice(cut).trim();
        }
        buffer = rest;
      } else {
        buffer = candidate;
      }
    }
    flush();
  }

  return chunks;
}

export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  return chunkSections([{ text, page: null }], options);
}
