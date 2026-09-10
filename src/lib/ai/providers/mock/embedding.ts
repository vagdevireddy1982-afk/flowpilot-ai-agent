import { EMBEDDING_DIMENSIONS } from "@/lib/ai/provider";

/**
 * Deterministic local embeddings.
 *
 * Real semantic embeddings need a model; for offline demos we use a hashed
 * bag-of-ngrams ("hashing trick") projection instead. It is not semantic — it
 * captures lexical overlap — but it is deterministic, free, has the same
 * dimensionality as `text-embedding-3-small`, and exercises the *entire*
 * retrieval path (pgvector storage, cosine ranking, thresholds, citations).
 * Setting AI_PROVIDER=openai swaps in true semantic vectors with no other
 * change.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was", "were",
  "be", "been", "it", "its", "this", "that", "these", "those", "we", "our", "you", "your",
  "i", "me", "my", "can", "could", "would", "should", "do", "does", "did", "with", "at",
  "by", "from", "as", "if", "then", "than", "so", "but", "not", "no", "yes", "please",
  // Interrogatives and filler: they appear in almost every question and in
  // most documents, so keeping them manufactures false overlap.
  "what", "when", "where", "who", "whom", "why", "how", "which", "whose", "will", "shall",
  "must", "may", "might", "need", "want", "about", "into", "over", "after", "before",
  "long", "take", "takes", "tell", "show", "find", "get", "got", "know", "any", "all",
  "some", "more", "most", "much", "many", "also", "only", "just", "very", "there", "here",
  "us", "let", "per", "via", "using", "use", "each", "such", "own", "same", "other",
]);

const SUFFIXES = [
  "ations",
  "ation",
  "ings",
  "ing",
  "ements",
  "ement",
  "ments",
  "ment",
  "ness",
  "ities",
  "ity",
  "ers",
  "ed",
  "es",
  "s",
  "y",
];

/**
 * Crude suffix stripping. Not linguistically correct, but it makes
 * "conversations"/"conversation" and "delivered"/"delivery" land on the same
 * token, which matters far more for retrieval than morphological purity.
 */
export function stem(word: string): string {
  if (word.length <= 4) return word;
  // "policies" → "policy" → "polic", so it meets "policy" at the same token.
  const base = word.endsWith("ies") ? `${word.slice(0, -3)}y` : word;
  for (const suffix of SUFFIXES) {
    if (base.length - suffix.length >= 3 && base.endsWith(suffix)) {
      return base.slice(0, -suffix.length);
    }
  }
  return base;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(stem);
}

/**
 * Each term is written into several dimensions. With a single slot per term,
 * one accidental hash collision between an unrelated query word and a document
 * word produces a large similarity score; spreading each term over PROBES slots
 * means a false match needs to collide in all of them, which pushes noise
 * scores toward zero while genuine term overlap keeps its full weight.
 */
const PROBES = 4;

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function embedText(text: string, dimensions = EMBEDDING_DIMENSIONS): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vector;

  const counts = new Map<string, number>();
  const add = (term: string) => counts.set(term, (counts.get(term) ?? 0) + 1);

  for (let i = 0; i < tokens.length; i += 1) {
    add(tokens[i]!);
    if (i + 1 < tokens.length) add(`${tokens[i]}_${tokens[i + 1]}`);
  }

  for (const [term, count] of counts) {
    // Bigrams carry more signal than single tokens.
    const weight = ((1 + Math.log(count)) * (term.includes("_") ? 1.4 : 1)) / Math.sqrt(PROBES);
    for (let probe = 0; probe < PROBES; probe += 1) {
      const hash = fnv1a(`${term}#${probe}`);
      const index = hash % dimensions;
      // Sign from an independent bit so colliding terms cancel instead of stacking.
      const sign = (fnv1a(`${term}#${probe}#sign`) & 1) === 0 ? 1 : -1;
      vector[index] += sign * weight;
    }
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
