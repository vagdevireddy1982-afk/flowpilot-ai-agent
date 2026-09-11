# FlowPilot — Enterprise AI Operations Agent

**An AI agent that understands business requests, retrieves enterprise knowledge, and safely executes real business workflows.**

FlowPilot is a full-stack operations platform where an AI agent works alongside
the team: it looks up customers and orders, answers policy questions from your
own documents with citations, files and updates support tickets, and — with a
human's explicit approval — cancels orders, issues refunds and emails customers.
Every action it takes is validated, risk-classified, permission-checked and
written to an audit trail.

It runs end to end with **no API key**: a deterministic mock provider stands in
for the LLM, so a fresh clone is a working demo in about two minutes.

---

## Table of contents

- [Why this project exists](#why-this-project-exists)
- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Mock AI mode and real LLM mode](#mock-ai-mode-and-real-llm-mode)
- [Demo scenarios](#demo-scenarios)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Deployment](#deployment)
- [Engineering decisions](#engineering-decisions)
- [Known limitations](#known-limitations)
- [Documentation](#documentation)

---

## Why this project exists

Most "AI agent" demos are a chat box in front of a model. The hard parts of
putting an agent into a business are the ones that never make it into the demo:

- What is the agent actually *allowed* to do, and who decided?
- What happens when it asks for something irreversible?
- How do you prove, afterwards, what it did and why?
- What does it do when it does not know?

FlowPilot is built around those four questions. The model is a component, not
the architecture: it proposes typed tool calls, and a permission gate, a schema
validator, a risk engine, an approval queue and an audit log stand between the
proposal and the database.

## Features

**AI agent**
- Natural-language requests → typed tool calls against real data
- Multi-step planning (resolve a customer, then act on them)
- Tool-execution traces with validated arguments, results and durations
- Conversation persistence: create, rename, pin, delete, continue
- Context-window management with a deterministic recap of older turns
- Escalation to a human when a request is out of scope or legally sensitive

**Human-in-the-loop**
- Cancellations, refunds and outbound email stop for confirmation
- Approval cards show real facts from the database, not the model's restatement
- Approve/reject with a note; both outcomes are stored and auditable
- Requests expire; decisions are re-validated and re-authorized at execution

**Knowledge base (RAG)**
- Upload PDF, Markdown or plain text; extract, chunk, embed, index
- pgvector-backed semantic search with a portable fallback store
- Citations that open the exact stored passage, with page numbers for PDFs
- Explicitly answers "the knowledge base does not contain enough information"

**Operations**
- Customers, orders (with item lines, event timelines and refunds) and tickets
- The same operations available to the agent are available to a human
- Dashboard, analytics, activity log, mock email outbox, settings

**Engineering**
- Strict TypeScript end to end, tRPC + Zod at the boundary
- Role-based access control enforced at the API *and* at tool execution
- Immutable audit trail with redaction of secret-looking values
- 100+ unit, integration and end-to-end tests
- Light and dark themes, command palette, keyboard shortcuts, responsive layout

## Architecture

```
                        ┌────────────────────────────────────────────┐
  Operator ─── request ─►  Next.js App Router (RSC + client islands) │
                        └───────────────┬────────────────────────────┘
                                        │ tRPC (typed, Zod-validated)
                        ┌───────────────▼────────────────────────────┐
                        │  Agent orchestrator                        │
                        │   • conversation memory + recap            │
                        │   • provider.generateWithTools()           │
                        └───────────────┬────────────────────────────┘
                                        │ proposed tool call (untrusted)
                        ┌───────────────▼────────────────────────────┐
                        │  Executor — the choke point                │
                        │   1. tool exists?          fail closed     │
                        │   2. caller's permission?  RBAC            │
                        │   3. Zod validation        never trust      │
                        │   4. risk engine           LOW/MED/HIGH    │
                        │   5. approval gate         HIGH stops here │
                        └───────────────┬────────────────────────────┘
                                        │ validated arguments
                        ┌───────────────▼────────────────────────────┐
                        │  Services  →  Prisma  →  PostgreSQL        │
                        │                          + pgvector        │
                        └───────────────┬────────────────────────────┘
                                        │ structured result + audit row
                        ┌───────────────▼────────────────────────────┐
                        │  Provider writes the final answer          │
                        └────────────────────────────────────────────┘
```

The model has no database handle, no SQL tool and no shell. Its entire
capability surface is a registry of sixteen reviewed functions.

Details: [`docs/architecture.md`](docs/architecture.md),
[`docs/ai-agent.md`](docs/ai-agent.md), [`docs/rag.md`](docs/rag.md),
[`docs/security.md`](docs/security.md), [`docs/database.md`](docs/database.md).

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, React 19, Server Components) |
| Language | TypeScript, strict |
| API | tRPC 11 + Zod 4 + superjson |
| Database | PostgreSQL 16 + pgvector, Prisma 7 (driver adapter) |
| Auth | Auth.js v5 (credentials, JWT sessions, bcrypt) |
| UI | Tailwind CSS v4, Radix primitives, Lucide icons, Recharts, cmdk, sonner |
| AI | Provider abstraction — deterministic mock, or any OpenAI-compatible API |
| Testing | Vitest (unit + integration), Playwright (end-to-end) |

## Local setup

**Requirements:** Node 20+, and either Docker or a local PostgreSQL 16.

```bash
git clone <your-fork-url> flowpilot-ai-agent
cd flowpilot-ai-agent

cp .env.example .env          # defaults work with the compose file below
npm install                   # also generates the Prisma client

docker compose up -d          # PostgreSQL 16 + pgvector on :5432
npm run db:migrate            # create the schema
npm run db:seed               # deterministic demo data
npm run dev                   # http://localhost:3000
```

Then open <http://localhost:3000> and sign in.

**Demo accounts** — all use the password `FlowPilot!2024`:

| Email | Role | What they can do |
| --- | --- | --- |
| `admin@flowpilot.demo` | ADMIN | Everything, including approving refunds and cancellations |
| `finance@flowpilot.demo` | ADMIN | Same, second approver for the approval demo |
| `ops@flowpilot.demo` | AGENT | Uses the agent; cannot refund, cancel or approve |
| `support@flowpilot.demo` | AGENT | Same |
| `viewer@flowpilot.demo` | VIEWER | Read-only; the agent is blocked entirely |

### Without Docker

Any PostgreSQL 16 works. Create the database and point `DATABASE_URL` at it:

```bash
createdb flowpilot
psql flowpilot -c "CREATE EXTENSION IF NOT EXISTS vector;"   # optional
```

pgvector is optional. With `VECTOR_STORE=auto` (the default) the app detects the
extension and uses it; without it, retrieval falls back to an in-application
cosine scan and everything still works.

### Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run db:migrate` | Apply migrations (development) |
| `npm run db:deploy` | Apply migrations (production) |
| `npm run db:seed` | Reseed the demo database |
| `npm run db:studio` | Prisma Studio |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Unit + integration tests |
| `npm run test:e2e` | Playwright end-to-end tests |

## Environment variables

Copy `.env.example` to `.env`. Every variable is validated at startup by a Zod
schema (`src/lib/env.ts`), so a misconfiguration fails immediately and clearly.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `AUTH_SECRET` | — | Session signing secret (required; `openssl rand -base64 32`) |
| `AI_PROVIDER` | `mock` | `mock` or `openai` |
| `LLM_API_KEY` | — | Required only for `openai`; without it the app falls back to `mock` |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint |
| `LLM_MODEL` | `gpt-4o-mini` | Chat model |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model (1536 dimensions) |
| `VECTOR_STORE` | `auto` | `auto`, `pgvector` or `fallback` |
| `EMAIL_PROVIDER` | `mock` | `mock` or `resend` |
| `RESEND_API_KEY` | — | Required for `resend` |
| `EMAIL_FROM` | `ops@flowpilot.demo` | Sender address |
| `DEMO_MODE` | `true` | Shows the demo account picker on the sign-in page |

Secrets are never sent to the browser. The settings page reports whether a key
is configured — never its value.

## Mock AI mode and real LLM mode

### Mock mode (default)

`AI_PROVIDER=mock` uses `MockAIProvider`: a deterministic planner that extracts
entities, selects tools and composes answers from the tools' own factual
summaries, plus hashed local embeddings for retrieval.

It is not a stub. It exercises the entire architecture — tool selection,
validation, risk classification, approvals, RAG, citations, audit — with zero
cost and zero variance, which is also why the test suite runs against it.

### Real LLM mode

```bash
AI_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
EMBEDDING_MODEL=text-embedding-3-small
```

Restart, then **re-index the knowledge base** (Knowledge base → the re-index
button on each document, or re-run `npm run db:seed`). Vectors from different
embedding models are not comparable, so the existing ones must be regenerated.

`LLM_BASE_URL` points the same provider at Azure OpenAI gateways, Together,
Groq, vLLM, Ollama's compatibility layer, or anything else that speaks the
OpenAI chat-completions and embeddings APIs.

## Demo scenarios

The full five-minute script is in [`docs/demo.md`](docs/demo.md). The short
version, all against seeded data:

| Ask | What it demonstrates |
| --- | --- |
| *Find customer Priya Sharma.* | Tool selection and a real lookup |
| *Show me order ORD-1004.* | Grounded facts (₹12,499.00, shipped, delayed) |
| *Create a high priority ticket for Priya Sharma because her order is delayed.* | Multi-step chaining and inferred priority/category |
| *Which orders are delayed right now?* | Filtered search across the order book |
| *Draft a follow-up email to customers whose orders are delayed.* | Approval gate on outbound communication |
| *According to our refund policy, can a delivered order be refunded?* | RAG with citations you can open |
| *According to our policy, who won the cricket world cup?* | Honest refusal when retrieval finds nothing |
| *Refund order ORD-1004.* | Approval gate, then real execution and an audit record |
| *Refund order ORD-1004.* as `ops@` | RBAC: the agent explains it cannot, and creates no request |

## Testing

```bash
npm test                # unit + integration (Vitest)
npm run test:e2e        # end-to-end (Playwright)
```

- **Unit** (`tests/unit`) — risk classification, RBAC and approval authority,
  the mock planner's intent and entity extraction, chunking, embeddings, tool
  schema validation, both providers' contracts, prompt and context assembly.
- **Integration** (`tests/integration`) — real turns against PostgreSQL: the
  agent loop, grounded answers with resolvable citations, the approval workflow
  (gate holds, approval executes, rejection changes nothing, expiry is
  enforced), business rules (partial refunds, cancellation eligibility), audit
  writes and redaction, and the RAG pipeline including pgvector storage.
- **End-to-end** (`tests/e2e`) — sign-in, the chat interface, a citation opening
  its source passage, the approval flow through the UI, knowledge search, the
  audit trail, and role restrictions.

Integration tests use the same database as development. They create records with
unique references and clean up afterwards, so seeded demo data survives a run.
The end-to-end suite reseeds first, because it performs real mutations.

## Project structure

```
prisma/
  schema.prisma            models, enums, indexes, pgvector column
  seed.ts                  deterministic demo data
  seed-data/               five policy documents, indexed at seed time
src/
  app/
    (app)/                 authenticated shell: dashboard, agent, records, oversight
    api/                   auth, tRPC and the knowledge upload route
    login/  page.tsx       sign-in and landing page
  components/
    ui/                    design-system primitives
    agent/                 chat transcript, tool traces, citations, approval cards
    customers/ orders/ tickets/ knowledge/ approvals/ activity/ settings/
    layout/ shared/ dashboard/ marketing/
  lib/
    ai/
      provider.ts          the AIProvider contract
      providers/           mock (planner + embeddings) and OpenAI-compatible
      agent/               orchestrator and executor
      tools/               registry and typed tool definitions
      risk/                action-risk classification
      rag/                 chunking, ingestion, vector stores, retrieval
      memory/              context window and recap
      prompts/             system prompt
    auth/  db/  email/     platform concerns
    env.ts errors.ts logger.ts rate-limit.ts utils.ts
  server/
    api/                   tRPC routers, context, permission gates
    services/              business logic — the only place Prisma is called
  types/
tests/
  unit/  integration/  e2e/
docs/
```

## Deployment

The application is a standard Next.js app and deploys to Vercel unchanged.

1. Provision PostgreSQL (Neon, Supabase, RDS…). If the provider supports
   `pgvector`, enable it and set `VECTOR_STORE=pgvector`; otherwise leave
   `VECTOR_STORE=auto` and the portable store is used.
2. Set the environment variables from the table above. `AUTH_SECRET` must be a
   fresh random value, and `DEMO_MODE` should be `false`.
3. Run migrations against the production database: `npm run db:deploy`.
4. Deploy. `postinstall` regenerates the Prisma client during the build.

Optionally seed a demo dataset with `npm run db:seed` — but never against a
database holding real records: the seed clears the tables it owns.

**This is not production-hardened.** See
[`docs/security.md`](docs/security.md#known-gaps) for the specific gaps
(no MFA, in-process rate limiting, no CSP, no field-level encryption).

## Engineering decisions

**The model never touches the database.** Every capability is a typed function
with a schema, a permission and a risk level. There is no SQL tool and no shell
tool, so the blast radius of a confused or manipulated model is finite and
enumerable — and a test asserts no such tool exists.

**Validation happens after the model, not before.** Tool arguments are re-parsed
with the tool's own Zod schema and the *parsed* value reaches the service. The
same re-validation runs again when an approved action finally executes, because
the user's role may have changed in between.

**Risk is a property of the action.** Classification happens server-side from
the tool name and its concrete arguments — never from the model's own assessment
of how dangerous it is being. Unknown tools are treated as high risk.

**Approval authority is narrower than approval visibility.** An operator who
cannot issue a refund cannot approve one either, which is what stops the
approval queue from becoming a privilege-escalation path.

**One service layer, two callers.** `order.refund` (a tRPC procedure) and
`createRefund` (an agent tool) both call the same service function, so a human
and the agent can never diverge in behaviour or in what gets audited.

**Money in minor units.** Integer paise everywhere; formatting happens once at
the edge. No floating-point money and no `Decimal` serialization problems across
the API boundary.

**Deterministic mock provider instead of a stub.** It plans, chains tool calls,
composes answers from tool results and produces embeddings — enough to exercise
and test the whole system offline, with none of an LLM's variance.

**Hybrid retrieval for the offline path.** Hashed embeddings carry real
collision noise, so mock-mode retrieval blends the vector score with IDF-weighted
lexical overlap and applies a relevance floor. That is what makes "the knowledge
base does not contain enough information" a real answer rather than an
aspiration.

**No repository layer.** Prisma is already a typed data-access API; a wrapper
would add indirection without capability. Shared query shapes are exported
constants instead.

**A modular monolith.** No queue, no microservices, no event bus. Every seam
that would need one — document ingestion status, the rate-limiter interface, the
vector-store interface, the provider interface — is already an interface.

## Known limitations

Stated plainly, because a portfolio project that overclaims is worse than one
that does not:

- **No streaming responses.** The mock provider is synchronous by construction;
  `AIProvider.supportsStreaming` exists, and the OpenAI path could stream, but
  the UI renders complete turns.
- **Mock embeddings are lexical, not semantic.** They are deterministic and
  free, and retrieval quality improves markedly with real embeddings. The
  hybrid ranking exists to compensate, but it still weighs a question's framing
  words: "according to our refund policy, can a delivered order be refunded?"
  ranks a chunk that repeats "refund policy" above the one stating the 30-day
  rule, so the grounded answer can quote a neighbouring section. The citations
  are real either way — the agent never invents a source — and real embeddings
  resolve the ordering.
- **Document ingestion runs inline**, so a very large PDF blocks its request.
  The status state machine is already queue-shaped.
- **No OCR**, so scanned PDFs are rejected with an explanatory error.
- **Single tenant.** One organization settings row.
- **Rate limiting is per-process** and resets on restart.
- **The e2e suite reseeds the database**, so do not point it at anything you
  care about.
- **pgvector is verified locally**; the fallback store is what runs where the
  extension is unavailable.

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Layering, request flow, the agent loop, what is deliberately absent |
| [`docs/ai-agent.md`](docs/ai-agent.md) | Tool catalogue, risk engine, approvals, memory, the mock provider |
| [`docs/rag.md`](docs/rag.md) | Chunking, embeddings, vector stores, ranking, citations |
| [`docs/security.md`](docs/security.md) | Threat model, controls, and an honest list of gaps |
| [`docs/database.md`](docs/database.md) | Schema conventions, entities, cascades, indexes, seed data |
| [`docs/demo.md`](docs/demo.md) | A five-minute walkthrough |

---

All data in this repository is fictional. FlowPilot is a portfolio project built
to demonstrate full-stack and AI engineering practice.

Licensed under the [MIT License](LICENSE).
