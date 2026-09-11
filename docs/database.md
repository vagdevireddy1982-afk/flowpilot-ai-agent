# Database design

PostgreSQL 16 with the `pgvector` extension, accessed through Prisma 7 (the
`prisma-client` generator with the `@prisma/adapter-pg` driver adapter).

## Conventions

- **cuid primary keys**, plus a human `reference` (`CUST-1001`, `ORD-1004`,
  `TKT-1001`, `REF-1001`) on records people talk about. Every lookup accepts
  either, which is what lets an operator or the agent say "ORD-1004".
- **Money in minor units.** `totalAmountMinor`, `refundedAmountMinor`,
  `unitPriceMinor` are integers of paise/cents. No floating-point money, and no
  `Decimal` serialization problems across the tRPC boundary. Formatting happens
  once, at the edge, in `formatMoney`.
- **Enums for state**, never free strings: `OrderStatus`, `PaymentStatus`,
  `DeliveryStatus`, `TicketStatus`, `TicketPriority`, `TicketCategory`,
  `RiskLevel`, `ApprovalStatus`, `ToolCallStatus`, `DocumentStatus`, `Role`,
  `ActorType`.
- **`ActorType`** (`USER` / `AGENT` / `SYSTEM`) appears on tickets, refunds,
  order events, emails and audit rows — the same operation is attributable to a
  human or to the agent, which is what the Human-vs-AI analytics measures.
- **Timestamps everywhere**, `createdAt` indexed wherever something is listed
  newest-first.

## Entities

### Identity

| Model | Notes |
| --- | --- |
| `User` | Email, bcrypt hash, role, avatar colour. Sessions are JWTs, so there are no `Account`/`Session` tables — adding an OAuth provider would add them. |

### Business records

| Model | Relationships |
| --- | --- |
| `Customer` | → orders, tickets, emails, escalations |
| `Order` | → items, events, refunds, tickets; belongs to a customer |
| `OrderItem` | sku, name, quantity, unit price |
| `OrderEvent` | append-only timeline (placed, paid, dispatched, delayed, delivered, cancelled, refunded) with the actor that caused it |
| `Refund` | amount, reason, status, who issued it |
| `SupportTicket` | status, priority, category, assignee, optional order link, `createdBy` actor |

### Agent execution

| Model | Purpose |
| --- | --- |
| `Conversation` | Owned by a user; pinning and titles |
| `Message` | USER / ASSISTANT / SYSTEM / TOOL, with `metadata` carrying citations, provider, model, latency, escalation and the pending approval id |
| `ToolCall` | Name, validated arguments, result, status, risk level, duration — one row per attempted tool execution, including refusals |
| `Approval` | 1:1 with a tool call: summary, risk, requester, decider, decision note, expiry |
| `AgentRun` | Per-turn telemetry: provider, model, latency, tokens, cost, tool count, knowledge use, escalation |
| `Escalation` | Hand-off to a human, with status and assignee |

### Knowledge

| Model | Purpose |
| --- | --- |
| `KnowledgeDocument` | Title, filename, mime type, size, `DocumentStatus`, chunk count, extracted text, uploader |
| `KnowledgeChunk` | Ordered chunk with optional page, token count, `embedding vector(1536)` for pgvector and `embeddingFallback Float[]` for the portable store, plus the embedding model that produced them |

`KnowledgeChunk` is unique on `(documentId, index)`, so re-indexing is
idempotent.

### Oversight

| Model | Purpose |
| --- | --- |
| `AuditLog` | Actor, tool, action, entity, redacted input/output, success, risk, approval status, duration. Indexed on `createdAt`, `userId`, `tool`, `success`, `riskLevel` — the exact filters the Activity page offers |
| `Email` | Recipient, subject, body, provider, status, actor, conversation link |
| `OrganizationSettings` | Single row (`id = "org"`): name, support email, currency, `autoApproveMediumRisk`, context budget, notification toggles |

## Cascades

Deleting a `Customer` removes their orders, items, events and tickets. Deleting
a `Conversation` removes its messages, tool calls and approvals. Deleting a
`KnowledgeDocument` removes its chunks. Where a record should survive the loss
of its actor — an audit row, a refund, a ticket assignee — the foreign key is
`SetNull` instead, so history is never silently erased.

## Indexes

Beyond the primary keys and unique references: customer status and name; order
customer, status, delivery status and placement date; ticket customer, status,
priority and creation date; conversation `(userId, updatedAt)`; message
`(conversationId, createdAt)`; tool call `(conversationId, createdAt)`, name and
status; approval `(status, createdAt)`; and the five audit-log filter columns.

## Migrations

`prisma/migrations` holds the SQL. The initial migration creates the `vector`
extension before the tables that depend on it, which works because the schema
declares `extensions = [vector]` under the `postgresqlExtensions` preview
feature.

Because Prisma cannot type a `vector` column, `embedding` is declared as
`Unsupported("vector(1536)")` and written through raw SQL in `PgVectorStore`.
Everything else in the schema is fully typed.

## Seed data

`npm run db:seed` produces a deterministic demo database (a fixed PRNG seed):
5 users, 25 customers, 40 orders with items and event timelines, 31 tickets,
14 emails, 5 indexed policy documents, 34 conversations with their tool calls
and agent runs, 12 approvals (3 still pending) and ~60 audit records spread over
the last 30 days.

The seed is idempotent — it clears the tables it owns before writing — so it can
be re-run at any time, and the end-to-end suite re-runs it to get a known
starting state.
