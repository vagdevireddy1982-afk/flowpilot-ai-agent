import { afterEach, describe, expect, it, vi } from "vitest";
import { MockAIProvider } from "@/lib/ai/providers/mock";
import { OpenAIProvider } from "@/lib/ai/providers/openai";
import { buildRecap } from "@/lib/ai/memory/context";
import { buildSystemPrompt } from "@/lib/ai/prompts/system";
import type { ChatMessage } from "@/lib/ai/provider";
import { AppError } from "@/lib/errors";

const TOOLS = [
  { name: "getOrder", description: "Fetch an order", parameters: {} },
  { name: "createRefund", description: "Refund an order", parameters: {} },
  { name: "searchKnowledgeBase", description: "Search policies", parameters: {} },
];

describe("MockAIProvider", () => {
  const provider = new MockAIProvider();

  it("requests a tool call for an actionable message", async () => {
    const result = await provider.generateWithTools({
      messages: [{ role: "user", content: "Show me order ORD-1004." }],
      tools: TOOLS,
    });
    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls[0]).toMatchObject({ name: "getOrder" });
  });

  it("writes the final answer from the tool's own summary", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Show me order ORD-1004." },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "getOrder", arguments: { orderId: "ORD-1004" } }],
      },
      {
        role: "tool",
        toolCallId: "call_1",
        name: "getOrder",
        content: JSON.stringify({
          ok: true,
          summary: "Order ORD-1004 for Priya Sharma — ₹12,499.00 — status Shipped.",
          data: { reference: "ORD-1004" },
        }),
      },
    ];

    const result = await provider.generateWithTools({ messages, tools: TOOLS });
    expect(result.toolCalls).toHaveLength(0);
    expect(result.content).toContain("Order ORD-1004 for Priya Sharma");
    // The mock must never invent a figure that is not in the tool result.
    expect(result.content).not.toMatch(/₹(?!12,499)/);
  });

  it("explains itself when the required tool is not available to the role", async () => {
    // An operator without order:refund still gets the read-only lookup, and is
    // then told plainly why the agent cannot finish the job.
    const result = await provider.generateWithTools({
      messages: [
        { role: "user", content: "Refund order ORD-1004." },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "getOrder", arguments: { orderId: "ORD-1004" } }],
        },
        {
          role: "tool",
          toolCallId: "call_1",
          name: "getOrder",
          content: JSON.stringify({
            ok: true,
            summary: "Order ORD-1004 — ₹12,499.00 — Shipped.",
            data: { reference: "ORD-1004" },
          }),
        },
      ],
      tools: [TOOLS[0]!],
    });
    expect(result.content).toMatch(/createRefund/);
    expect(result.content).toMatch(/isn't available to your role/i);
    expect(result.toolCalls).toHaveLength(0);
  });

  it("says the knowledge base is insufficient rather than guessing", async () => {
    const result = await provider.generateWithTools({
      messages: [
        { role: "user", content: "According to our policy, what is the capital of France?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call_1", name: "searchKnowledgeBase", arguments: { query: "capital of France" } },
          ],
        },
        {
          role: "tool",
          toolCallId: "call_1",
          name: "searchKnowledgeBase",
          content: JSON.stringify({ ok: true, summary: "nothing", data: {}, citations: [] }),
        },
      ],
      tools: TOOLS,
    });
    expect(result.content).toMatch(/does not contain enough information/i);
  });

  it("surfaces a tool failure instead of pretending it worked", async () => {
    const result = await provider.generateWithTools({
      messages: [
        { role: "user", content: "Show me order ORD-9999." },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "getOrder", arguments: { orderId: "ORD-9999" } }],
        },
        {
          role: "tool",
          toolCallId: "call_1",
          name: "getOrder",
          content: JSON.stringify({ ok: false, code: "NOT_FOUND", error: 'Order "ORD-9999" was not found.' }),
        },
      ],
      tools: TOOLS,
    });
    expect(result.content).toContain("ORD-9999");
    expect(result.content).toMatch(/couldn't complete/i);
  });

  it("reports token usage so cost accounting has something to record", async () => {
    const result = await provider.generateWithTools({
      messages: [{ role: "user", content: "Find customer Priya Sharma." }],
      tools: TOOLS,
    });
    expect(result.usage.promptTokens).toBeGreaterThan(0);
  });
});

describe("OpenAIProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps an OpenAI tool call onto the provider contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          model: "gpt-4o-mini",
          usage: { prompt_tokens: 120, completion_tokens: 8 },
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_abc",
                    type: "function",
                    function: { name: "getOrder", arguments: '{"orderId":"ORD-1004"}' },
                  },
                ],
              },
            },
          ],
        }),
      ),
    );

    const provider = new OpenAIProvider("gpt-4o-mini", "text-embedding-3-small", "key", "https://api.test/v1");
    const result = await provider.generateWithTools({
      messages: [{ role: "user", content: "Show me order ORD-1004." }],
      tools: TOOLS,
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls[0]).toEqual({
      id: "call_abc",
      name: "getOrder",
      arguments: { orderId: "ORD-1004" },
    });
    expect(result.usage.promptTokens).toBe(120);
  });

  it("survives malformed tool arguments without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          model: "gpt-4o-mini",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  { id: "c1", type: "function", function: { name: "getOrder", arguments: "{not json" } },
                ],
              },
            },
          ],
        }),
      ),
    );

    const provider = new OpenAIProvider("gpt-4o-mini", "text-embedding-3-small", "key", "https://api.test/v1");
    const result = await provider.generateWithTools({ messages: [], tools: TOOLS });
    // Empty arguments are then rejected by the tool's Zod schema downstream.
    expect(result.toolCalls[0]!.arguments).toEqual({});
  });

  it("translates a rate limit into a typed application error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));

    const provider = new OpenAIProvider("gpt-4o-mini", "text-embedding-3-small", "key", "https://api.test/v1");
    await expect(provider.generateResponse({ messages: [] })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("does not leak provider internals into the user-facing message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("stack trace with internal host names", { status: 500 })),
    );

    const provider = new OpenAIProvider("gpt-4o-mini", "text-embedding-3-small", "key", "https://api.test/v1");
    await expect(provider.generateResponse({ messages: [] })).rejects.toSatisfy(
      (error: AppError) => !error.userMessage.includes("internal host names"),
    );
  });
});

describe("context and prompt assembly", () => {
  it("summarises dropped turns with the entities they mentioned", () => {
    const recap = buildRecap([
      { role: "USER", content: "Look at ORD-1004 for Priya" },
      { role: "ASSISTANT", content: "Ticket TKT-1031 is open on that order" },
    ]);
    expect(recap).toContain("ORD-1004");
    expect(recap).toContain("TKT-1031");
    expect(recap).toContain("2 older message");
  });

  it("tells the model which tools exist and forbids answering from memory", () => {
    const prompt = buildSystemPrompt({
      organizationName: "FlowPilot Demo Co.",
      userName: "Aarav",
      userRole: "ADMIN",
      availableTools: ["getOrder", "createRefund"],
      currency: "INR",
      now: new Date("2026-03-01T00:00:00Z"),
    });

    expect(prompt).toContain("getOrder, createRefund");
    expect(prompt).toContain("2026-03-01");
    expect(prompt).toMatch(/never answer business questions from memory/i);
    expect(prompt).toMatch(/approves them/i);
  });
});
