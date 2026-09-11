# Demo script

Everything below runs against the seeded database with the deterministic mock
provider — no API key required. Sign in as `admin@flowpilot.demo` /
`FlowPilot!2024` unless a scenario says otherwise.

Total runtime: about five minutes.

## 0. Set the scene (30s)

Open `/` and point at the architecture strip: the model proposes, the platform
validates, classifies risk, asks a human when it matters, and records
everything. Then open `/dashboard` — every number on it is a database query.

## 1. Find a customer

> **Find customer Priya Sharma.**

The tool trace above the answer shows `searchCustomers` and its duration. Expand
it to show the validated arguments and the structured result: the answer is
assembled from that result, not from the model's memory.

## 2. Look at her order

> **Show me order ORD-1004.**

Real reference, real amount (₹12,499.00), real status — shipped, paid, delivery
delayed. Cross-check it at `/orders` by searching `ORD-1004`.

## 3. Open a ticket for her

> **Create a high priority support ticket for Priya Sharma because her order is delayed.**

Two chained tool calls: the customer is resolved first, then the ticket is
created with priority `HIGH` and category `DELIVERY` inferred from the request.
Open `/tickets` and the new `TKT-…` is at the top, marked *Created by agent*.

## 4. Find everything that is late

> **Which orders are delayed right now?**

`searchOrders` with `delayedOnly`. This is the same saved view as the "Delayed
only" button on `/orders`.

## 5. Draft outreach to those customers

> **Draft a follow-up email to customers whose orders are delayed.**

The agent finds the delayed orders, drafts a message for the first affected
customer — and stops. Outbound email is HIGH risk, so it needs a human. Read the
preview: real recipient, real subject, real body.

Click **Reject** with a note. The agent replies that nothing was changed, and
`/approvals` records the rejection with your note against your name.

## 6. Ask a policy question

> **According to our refund policy, can a delivered order be refunded?**

The answer is grounded in retrieved passages and lists its sources. Click a
source: the exact stored chunk opens, with its document and page. Nothing is
fabricated — the citation is the passage that produced the answer.

## 7. Ask something the knowledge base cannot answer

> **According to our policy, who won the cricket world cup?**

The agent says the knowledge base does not contain enough information and offers
to escalate. This is the interesting half of RAG: knowing when to say nothing.

## 8. Refund the order — with approval

> **Refund order ORD-1004.**

The agent reads the order first, then proposes `createRefund` and stops at the
approval card: customer, order total, already refunded, refund amount, order
status, reason, and *why* approval is required.

Before approving, open `/orders` in another tab and confirm ORD-1004 is still
`Paid`. Nothing has run.

Click **Approve and run**. The refund executes, the agent reports the refund
reference and the new payment status, and `/orders` now shows `Refunded`.

## 9. Show the paper trail

Open `/activity`:

- filter **Actor = AGENT** to see everything the agent did;
- expand `agent.tool.createRefund` for the exact arguments and result;
- filter **Outcome = Failed** to show that refusals are recorded too;
- switch to **Sent email** for the mock outbox, and **Escalations** for hand-offs.

## 10. Show that roles are real

Sign out and sign in as `ops@flowpilot.demo` (Operator) with the same password.

> **Refund order ORD-1004.**

The agent performs the lookup, then explains that `createRefund` is not
available to this role. No approval request is created — an operator cannot
propose an action they could never perform. `/agent` is blocked entirely for
`viewer@flowpilot.demo`.

## 11. Escalation

Back as the admin:

> **The customer says their lawyer will be in touch about this delay.**

The agent escalates instead of improvising, and the hand-off appears under
`/activity` → **Escalations**.

## 12. Close on the engineering

- `/settings` → **AI provider**: the active provider, model, embedding model,
  vector store, and the full tool registry with each tool's permission and risk
  level.
- `/analytics`: success and failure counts, approval rate, escalations, latency
  percentiles and estimated token cost — all from `AgentRun` and `ToolCall`
  rows.

## Resetting

The demo mutates real data (ORD-1004 ends up refunded). To start over:

```bash
npm run db:seed
```
