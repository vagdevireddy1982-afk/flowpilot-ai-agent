# Security model

FlowPilot is a portfolio project, not a hardened production system. This
document states plainly what is implemented, and what a real deployment would
still need.

## Threat model

The interesting adversary is not a classic web attacker — it is **the model
itself**, plus anyone who can influence it. A prompt-injected document, a
crafted customer message or a plain hallucination can all cause the model to
propose an action nobody wanted. The design assumption is therefore: *the model
will eventually ask for something wrong; the platform must make that harmless.*

## Controls

### 1. Authentication

Auth.js (NextAuth v5) with a credentials provider and JWT sessions. Passwords
are bcrypt hashes (cost 10). A failed sign-in never reveals whether the email
exists. Sessions last eight hours.

`src/proxy.ts` keeps signed-out visitors out of the app shell, but it is only a
redirect: every tRPC procedure and server component re-checks the session
independently.

### 2. Authorization

Three roles (ADMIN, AGENT, VIEWER) map to an explicit permission list in
`src/lib/auth/rbac.ts`. Call sites ask for a permission, never for a role.

Enforcement happens at three points:

- **API** — `permissionProcedure("order:refund")` gates the tRPC route.
- **Tool advertisement** — the model is only *told about* the tools the user's
  role permits, so it usually does not ask for the impossible.
- **Tool execution** — the executor re-checks the permission anyway, because
  advertisement is a hint and enforcement must not depend on the model.

### 3. Never trust model output

Arguments arriving from the model are re-parsed with the tool's own Zod schema
before anything else happens. The **parsed** value is what reaches the service —
not the raw object. Malformed JSON from a provider degrades to an empty object,
which then fails validation with a clear message.

Approved actions are re-validated at execution time too: the stored arguments go
through the schema again, and the permission is re-checked, because the user's
role may have changed between proposal and approval.

### 4. Finite capability surface

The agent can call sixteen reviewed functions. There is no tool that executes
SQL, runs a shell command, makes an arbitrary HTTP request or writes to the
filesystem. Prisma is only ever called from services with parameterised queries;
the two raw queries in the codebase (pgvector search and the extension check)
use bound parameters.

A test asserts that no tool name matches `sql|query|exec|shell|eval`.

### 5. Risk classification and human approval

Irreversible or externally visible actions — cancellations, refunds, outbound
email — are HIGH risk and cannot execute without a human decision recorded in
the database. Unknown tools are treated as HIGH: the engine fails closed.

Approval authority is narrower than approval visibility: seeing a request needs
`approval:read`; deciding one needs `approval:decide`, or being the requester
*and* holding the permission the tool itself requires.

### 6. Audit trail

Every tool call, permission refusal, approval decision and human mutation writes
an `AuditLog` row: actor, tool, arguments, result, risk level, approval status,
duration and outcome. Values are redacted on the way in — any key that looks
like a password, token, secret or API key is replaced before storage, and large
payloads are truncated.

### 7. Secrets

Secrets live in environment variables, validated once at startup by a Zod schema
(`src/lib/env.ts`). Nothing under `src/lib/env.ts` is imported by a client
component. The settings page reports *whether* a key is configured, never the
key. `.env` is git-ignored; `.env.example` carries only placeholders.

### 8. Rate limiting

A token-bucket limiter (`src/lib/rate-limit.ts`) caps agent turns per user and
uploads per user. It is an in-process implementation behind a `RateLimiter`
interface — correct for a single instance, and one file away from a Redis
implementation for several.

### 9. Error handling

Domain errors carry a user-safe message and map onto tRPC codes at the boundary.
Anything unrecognised is logged server-side with a request id and returned to
the client as a generic message. Stack traces, SQL errors and provider payloads
never reach the browser.

### 10. Input validation

Zod at every boundary: tRPC inputs, tool arguments, environment, upload route.
Uploads are restricted by type and size (8 MB), and the extracted text is
treated as data — the markdown renderer in the chat interprets a small,
explicit subset and never renders HTML, so a document cannot inject markup.

## Known gaps

These are real, and pretending otherwise would be worse than listing them:

- **Prompt injection is mitigated, not solved.** A malicious knowledge document
  can still influence what the agent *says*. It cannot escalate what the agent
  *does*, because doing requires a tool, a permission and (for anything
  dangerous) a human approval.
- **No CSRF token on the upload route.** It is same-origin and cookie-authed;
  Auth.js protects its own endpoints. A production build should add one.
- **No MFA, password rotation, account lockout or session revocation list.**
- **Rate limiting is per-process.** Multiple instances multiply the budget.
- **No encryption at rest beyond what Postgres provides**, and no field-level
  encryption for customer PII.
- **No security headers/CSP** beyond framework defaults.
- **Audit logs are append-only by convention, not by permission.** A database
  user with write access could alter them.

## If this were going to production

Rotate `AUTH_SECRET`, put the database behind a private network, add CSP and
security headers, move rate limiting to Redis, add MFA for ADMIN accounts, ship
audit logs to append-only storage, and put a real review process in front of the
tool registry — because adding a tool is the one change that widens what the
agent can do.
