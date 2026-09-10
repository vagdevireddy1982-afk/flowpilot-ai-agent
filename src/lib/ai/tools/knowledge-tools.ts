import { z } from "zod";
import { retrieveKnowledge } from "@/lib/ai/rag/retriever";
import { defineTool, ok } from "@/lib/ai/tools/types";

export const searchKnowledgeBaseTool = defineTool({
  name: "searchKnowledgeBase",
  description:
    "Semantic search over uploaded company policy documents. Use for any question about policy, SLAs, warranties or internal procedure. Never answer such questions from memory.",
  permission: "knowledge:read",
  schema: z.object({
    query: z.string().min(3).describe("The user's question, in their own words"),
    limit: z.number().int().min(1).max(8).optional().default(4),
  }),
  async execute({ query, limit }) {
    const { matches, citations, insufficient, store } = await retrieveKnowledge(query, limit);

    if (insufficient) {
      return ok(
        "The knowledge base does not contain a passage relevant to that question, so there is nothing to ground an answer in.",
        { query, insufficient: true, store, passages: [] },
        [],
      );
    }

    return ok(
      `Found ${matches.length} relevant passage${matches.length > 1 ? "s" : ""} in ${new Set(
        matches.map((match) => match.documentTitle),
      ).size} document(s).`,
      {
        query,
        insufficient: false,
        store,
        passages: matches.map((match) => ({
          documentTitle: match.documentTitle,
          page: match.page,
          score: Number(match.score.toFixed(4)),
          content: match.content,
        })),
      },
      citations,
    );
  },
});
