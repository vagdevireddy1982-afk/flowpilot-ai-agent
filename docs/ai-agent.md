# The AI agent

## What "agent" means here

The agent is not a chat wrapper. Given a request in English it decides which
typed backend operation is needed, proposes it with concrete arguments, and —
once validation, permissions, risk and (where required) a human approval have
passed — the platform executes it against the real database and reports back
what changed.

## Tool catalogue

Sixteen tools, each with a Zod schema, a required permission and a base risk
level. `src/lib/ai/tools/registry.ts` is the single source of truth; the
settings page renders this same list at runtime.

| Tool | Permission | Risk | What it does |
| --- | --- | --- | --- |
| `getCustomer` | `customer:read` | LOW | One customer by id, reference or email, with counts |
| `searchCustomers` | `customer:read` | LOW | Free-text customer search |
| `getCustomerOrderHistory` | `order:read` | LOW | A customer's recent orders |
| `getOrder` | `order:read` | LOW | One order with items and status |
| `searchOrders` | `order:read` | LOW | Filter orders, including the delayed view |
| `getOrderHistory` | `order:read` | LOW | Event timeline and refunds for an order |
| `getTicket` | `ticket:read` | LOW | One support ticket |
| `getCustomerTickets` | `ticket:read` | LOW | A customer's tickets |
| `searchKnowledgeBase` | `knowledge:read` | LOW | Semantic search over policy documents |
| `createSupportTicket` | `ticket:write` | MEDIUM | Opens a ticket |
| `updateSupportTicket` | `ticket:write` | MEDIUM | Status, priority or category change |
| `updateCustomerNotes` | `customer:write` | MEDIUM | Replaces internal account notes |
| `escalateToHuman` | `agent:use` | MEDIUM | Hands the conversation to a specialist |
| `cancelOrder` | `order:cancel` | **HIGH** | Cancels an undelivered order |
| `createRefund` | `order:refund` | **HIGH** | Refunds money, fully or partially |
| `sendCustomerEmail` | `email:send` | **HIGH** | Sends mail that leaves the company |

There is no SQL tool, no HTTP tool and no shell tool. That is a design
constraint, not an omission — it is what makes the blast radius of a
compromised or confused model finite and enumerable.

## Tool result contract

Every tool returns the same envelope:

```ts
{ ok: true,  summary: string, data: T, citations?: Citation[] }
{ ok: false, code: string,    error: string }
```

`summary` is a factual one-liner built from the database result. A real LLM gets
both the summary and the structured `data`; the mock provider composes its final
answer from the summaries alone, which is why it can never state a figure that
is not in the database.

## Risk engine

`src/lib/ai/risk/index.ts` maps a tool to a base level and then applies rules
that can *raise* (never lower) it based on the concrete arguments:

- an unknown tool is HIGH — fail closed;
- a refund of ₹25,000 or more adds an escalation reason;
- an email whose body mentions a refund or compensation adds one;
- resolving or closing a ticket is flagged as ending the customer's thread.

`requiresApproval` is true for every HIGH action, and for MEDIUM ones when the
organization turns off `autoApproveMediumRisk` in Settings.

## Human-in-the-loop

When a call requires approval the executor:

1. builds a **preview** — real facts pulled from the database (customer, amount,
   current status, reason) rather than a restatement of the model's arguments;
2. writes a `ToolCall` with status `AWAITING_APPROVAL` and a `PENDING`
   `Approval`;
3. returns, ending the turn. Nothing has run.

The operator sees the preview inline in the chat and in the Approvals queue.
Approving replays the *stored, already-validated* arguments through the schema
again, executes the tool, appends the result to the conversation and asks the
provider for the closing message. Rejecting marks the tool call `REJECTED` and
posts an assistant message stating that nothing changed.

Who may approve is deliberately narrow (`approval-service.ts:canDecide`):
anyone with `approval:decide` (ADMIN), or the requester themselves *provided
they personally hold the permission the tool requires*. An AGENT cannot
self-approve a refund, because an AGENT cannot issue refunds directly either.

## Conversation memory

`src/lib/ai/memory/context.ts` replays the most recent USER and ASSISTANT turns
(bounded by both a message count and a character budget) and, when older turns
were dropped, prepends a deterministic recap listing the opening request and
every business reference mentioned so far.

Tool call/result pairs are not replayed. They are large, they are already
summarised in the assistant's answer, and a partial pair would be an invalid
message sequence for OpenAI-style APIs. The live turn still receives its own
tool messages in full.

## The mock provider

`MockAIProvider` exists so the entire product — including approvals and RAG —
can be demonstrated and tested with no API key and no variance.

- `planNextStep` is a pure function of `(user message, previous tool steps)`.
  It extracts entities (order/ticket/customer references, names, amounts),
  recognises intents, and chains multi-step work: search the customer, then
  create the ticket; find delayed orders, then email each customer in turn.
- Answers are assembled from tool summaries and retrieved passages. For a
  knowledge question it performs extractive selection — it quotes the sentences
  from the retrieved chunks that overlap the question — so a grounded answer is
  verifiably faithful to its citation.
- If the planner picks a tool the user's role cannot run, the provider says so
  explicitly instead of quietly answering with whatever it already had.

Swapping in `OpenAIProvider` changes none of the above machinery: the loop, the
executor, the risk engine, the approval flow and the audit trail are all
provider-agnostic.

## Evaluating the agent

Behaviour is pinned by tests rather than by eyeballing a demo:

- `tests/unit/mock-planner.test.ts` — intent and entity extraction, multi-step
  chaining, refusal cases.
- `tests/unit/provider.test.ts` — the contract both providers must satisfy,
  including malformed tool arguments and rate limits.
- `tests/integration/agent-loop.test.ts` — real turns against Postgres:
  grounded answers, citations that resolve, missing records, ownership, limits.
- `tests/integration/approval-workflow.test.ts` — the gate holds, the action
  runs only after approval, rejection changes nothing, expiry is enforced.
