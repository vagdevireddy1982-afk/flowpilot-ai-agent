# Architecture

FlowPilot is a modular monolith: one Next.js application, one Postgres
database, and a clear internal boundary between the AI layer, the business
services and the transport layer. There is no message bus, no microservice, and
no background worker — none of them would earn their keep at this size, and
every one of them would make the system harder to reason about.

## Request flow

```
Browser (React Server Components + client islands)
  │
  ├── tRPC procedure  ──►  permission gate  ──►  service  ──►  Prisma  ──►  Postgres
  │
  └── Agent turn      ──►  orchestrator
                             ├─ conversation memory  (recent turns + recap)
                             ├─ provider.generateWithTools()   ← the only LLM call
                             ├─ executor
                             │    ├─ tool exists?          (fail closed)
                             │    ├─ caller's permission?  (RBAC)
                             │    ├─ Zod validation        (never trust the model)
                             │    ├─ risk classification   (LOW / MEDIUM / HIGH)
                             │    ├─ approval gate         (HIGH stops here)
                             │    └─ service call          (same code the UI uses)
                             ├─ audit write
                             └─ provider call #2 → final answer → persisted
```

The model never receives a database handle, a SQL string or a shell. Its entire
capability surface is the tool registry, and every entry in that registry is a
typed function with a schema, a permission and a risk level.

## Layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| App routes | `src/app` | Pages, layouts, route handlers, auth callbacks |
| Components | `src/components` | Design system (`ui/`) and feature UI |
| Transport | `src/server/api` | tRPC routers, context, permission gates, error mapping |
| Services | `src/server/services` | Business rules and the only place Prisma is called |
| AI | `src/lib/ai` | Provider abstraction, agent loop, tools, risk, RAG, memory |
| Platform | `src/lib` | Auth, database client, errors, logging, rate limiting, email |
| Schema | `prisma` | Models, migrations, seed data |

Dependencies point inwards: the AI layer calls services, services call Prisma,
and nothing calls back outwards. A tool and a tRPC procedure that do the same
thing (`createRefund` and `order.refund`) share one service function, so the
agent and a human operator can never diverge in behaviour.

### Why no repository layer

Prisma already is the repository: it is a typed, mockable data-access API. A
hand-written wrapper around it would add a layer of indirection without adding a
capability, so the services own their queries directly. Where a query is shared
(the `ORDER_INCLUDE` shape, the "delayed" definition) it is exported as a
constant or a function rather than duplicated.

## The agent loop

`src/lib/ai/agent/orchestrator.ts` runs at most five tool steps per turn:

1. Load the user, the organization settings and the conversation.
2. Persist the user message; title the conversation if it is the first one.
3. Build the context window (recent turns, plus a deterministic recap of what
   fell outside it).
4. Ask the provider for a response, advertising only the tools the user's role
   permits.
5. If the provider asked for a tool, hand it to the executor.
   - A `HIGH`-risk tool stops the turn, creates an `Approval` row and returns.
   - Anything else executes and its structured result is appended to the
     context.
6. Repeat until the provider answers without a tool call, or the step budget is
   spent.
7. Persist the assistant message with its citations, and write an `AgentRun`
   record for analytics.

Approvals resume the loop: `resumeAfterApproval` runs the stored tool call,
feeds the result back to the provider and stores the final answer, so an
approved action reads exactly like an uninterrupted turn.

## Provider abstraction

`AIProvider` has three methods: `generateResponse`, `generateWithTools` and
`generateEmbedding`. Two implementations ship:

- **`MockAIProvider`** — deterministic. A pure planner (`providers/mock/intent.ts`)
  chooses the tool; answers are composed from the tools' own factual summaries;
  embeddings are a hashed bag-of-ngrams projection. No network, no key, no
  variance — which also makes it the provider the tests run against.
- **`OpenAIProvider`** — any OpenAI-compatible `/chat/completions` and
  `/embeddings` endpoint, selected by `AI_PROVIDER=openai` plus `LLM_API_KEY`.

`getAIProvider()` is the only place that knows which is active, and it falls
back to the mock whenever credentials are missing, so a fresh clone always runs.

## Data model

See [`database.md`](./database.md). The short version: business records
(`Customer`, `Order`, `SupportTicket`), agent execution (`Conversation`,
`Message`, `ToolCall`, `Approval`, `AgentRun`, `Escalation`), knowledge
(`KnowledgeDocument`, `KnowledgeChunk`) and oversight (`AuditLog`, `Email`).

## Observability

- Structured JSON logs (`src/lib/logger.ts`) for agent turns, tool failures,
  retrieval and slow tRPC calls.
- `AuditLog` is the durable record: actor, tool, arguments, result, risk,
  approval state, duration, success.
- `AgentRun` carries latency, token counts and estimated cost, which is what the
  analytics page reads.

## What is deliberately not here

- **Streaming responses.** The mock provider is synchronous by construction;
  `AIProvider.supportsStreaming` exists and the OpenAI implementation could add
  a streaming path, but the UI currently renders complete turns.
- **Background jobs.** Document ingestion runs inline. The `DocumentStatus`
  enum (`PENDING → PROCESSING → READY | FAILED`) is already the contract a queue
  would need, so moving it is a small change.
- **Multi-tenancy.** One organization, one settings row. Adding a tenant id
  would touch every service query, which is exactly the kind of change this
  layering makes mechanical rather than risky.
