import {
  Activity,
  ArrowRight,
  BookOpen,
  Bot,
  Database,
  GitBranch,
  LineChart,
  ShieldCheck,
  Workflow,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { ArchitectureDiagram } from "@/components/marketing/architecture-diagram";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { resolveAiProvider } from "@/lib/env";

const FEATURES = [
  {
    icon: Bot,
    title: "An agent that acts, not just answers",
    body: "FlowPilot reads the request, decides which typed backend tool is needed, validates the arguments and runs the operation against the real database.",
  },
  {
    icon: Wrench,
    title: "Workflow automation with typed tools",
    body: "Sixteen tools cover customers, orders, tickets, refunds, email and knowledge. Every one has a Zod schema, a permission and a risk level.",
  },
  {
    icon: BookOpen,
    title: "Grounded answers from your documents",
    body: "Policies are chunked, embedded and stored in pgvector. Answers cite the passage they came from — and say so when the corpus has nothing relevant.",
  },
  {
    icon: ShieldCheck,
    title: "Human approval where it matters",
    body: "Cancellations, refunds and outbound email stop at a confirmation card. The action executes only after a human with the right role approves it.",
  },
  {
    icon: Activity,
    title: "Auditable by construction",
    body: "User, tool, arguments, result, risk level, approval state, duration — every action is written to an immutable audit log you can filter.",
  },
  {
    icon: LineChart,
    title: "Analytics from real rows",
    body: "Success rate, approval rate, escalations, latency percentiles and estimated token cost, all computed from the operational database.",
  },
];

export default async function LandingPage() {
  const session = await auth();
  const provider = resolveAiProvider();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Workflow className="size-4" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">FlowPilot</span>
          </Link>
          <nav className="ml-6 hidden items-center gap-5 text-[13px] text-muted-foreground md:flex">
            <a href="#capabilities" className="hover:text-foreground">
              Capabilities
            </a>
            <a href="#architecture" className="hover:text-foreground">
              Architecture
            </a>
            <a href="#safety" className="hover:text-foreground">
              Safety
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={session?.user ? "/dashboard" : "/login"}>
                {session?.user ? "Dashboard" : "Sign in"}
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href={session?.user ? "/agent" : "/login"}>
                Open agent <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden border-b">
          <div className="grid-backdrop pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative mx-auto w-full max-w-6xl px-4 py-20 text-center sm:py-28">
            <Badge variant="neutral" className="mx-auto mb-5 px-2.5 py-1 text-[12px]">
              <span className="mr-1.5 inline-block size-1.5 rounded-full bg-success" />
              Running on the {provider === "mock" ? "deterministic mock provider" : "configured LLM provider"}
            </Badge>
            <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Your AI Operations Agent
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base text-pretty text-muted-foreground">
              FlowPilot connects enterprise knowledge, customers and workflows so teams resolve
              requests faster — with typed tools, human approval on high-risk actions and a complete
              audit trail behind every decision.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href={session?.user ? "/agent" : "/login"}>
                  Open Agent <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href={session?.user ? "/dashboard" : "/login"}>Explore Demo</Link>
              </Button>
            </div>
            <p className="mt-5 text-[12px] text-muted-foreground">
              Demo sign-in: <code className="font-mono">admin@flowpilot.demo</code> ·{" "}
              <code className="font-mono">FlowPilot!2024</code>
            </p>
          </div>
        </section>

        <section id="capabilities" className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20">
          <h2 className="text-2xl font-semibold tracking-tight">What it does</h2>
          <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">
            Not a chat wrapper: a full operations surface where the agent, the records and the
            controls live in the same product.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="panel p-5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <feature.icon className="size-4" />
                </span>
                <h3 className="mt-3.5 text-[15px] font-medium">{feature.title}</h3>
                <p className="mt-1.5 text-[13px] text-muted-foreground">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="architecture" className="border-y bg-surface-muted/50">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20">
            <h2 className="text-2xl font-semibold tracking-tight">How a request flows</h2>
            <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">
              The model never touches the database. It can only propose a tool call, which is
              validated, risk-classified, permission-checked and audited before anything happens.
            </p>
            <div className="mt-8">
              <ArchitectureDiagram />
            </div>
          </div>
        </section>

        <section id="safety" className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Safety is structural</h2>
              <p className="mt-2 text-[15px] text-muted-foreground">
                Guardrails live in code, not in the prompt. A jailbroken model still cannot exceed
                the permissions of the human it is acting for.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  {
                    icon: GitBranch,
                    title: "Validated arguments",
                    body: "Model output is re-parsed with the tool's own Zod schema. Invalid arguments never reach a service.",
                  },
                  {
                    icon: ShieldCheck,
                    title: "Risk classification",
                    body: "Every action is LOW, MEDIUM or HIGH. High-risk actions require an explicit human decision that is stored in the database.",
                  },
                  {
                    icon: Database,
                    title: "No direct database access",
                    body: "There is no SQL tool and no shell tool. The agent's entire capability surface is the reviewed tool registry.",
                  },
                  {
                    icon: Activity,
                    title: "Immutable audit trail",
                    body: "Who asked, what ran, with which arguments, what came back, and who approved it.",
                  },
                ].map((item) => (
                  <li key={item.title} className="flex gap-3">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                      <item.icon className="size-3.5 text-muted-foreground" />
                    </span>
                    <span>
                      <span className="block text-[14px] font-medium">{item.title}</span>
                      <span className="block text-[13px] text-muted-foreground">{item.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="panel overflow-hidden">
              <div className="border-b bg-surface-muted px-4 py-2.5 text-[12px] font-medium text-muted-foreground">
                Example — refund request
              </div>
              <div className="space-y-3 p-4 font-mono text-[12px] leading-relaxed">
                <p className="text-muted-foreground">operator</p>
                <p className="rounded-md bg-muted px-3 py-2">Refund order ORD-1004.</p>
                <p className="text-muted-foreground">agent · tool call</p>
                <p className="rounded-md border border-dashed px-3 py-2">
                  getOrder({"{"} orderId: &quot;ORD-1004&quot; {"}"}) → ₹12,499 · Shipped · Paid
                </p>
                <p className="text-muted-foreground">agent · needs approval</p>
                <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                  createRefund({"{"} orderId: &quot;ORD-1004&quot; {"}"}) — HIGH risk. A refund of
                  ₹12,499 will be initiated. Approve?
                </p>
                <p className="text-muted-foreground">operator → approved</p>
                <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2">
                  Refunded ₹12,499 · refund REF-1012 · audit log written
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">See it work</h2>
            <p className="mx-auto mt-2 max-w-xl text-[15px] text-muted-foreground">
              The demo runs without any API key. Sign in and ask the agent to look up an order,
              check a policy, or refund a customer.
            </p>
            <Button asChild size="lg" className="mt-6">
              <Link href={session?.user ? "/agent" : "/login"}>
                Open Agent <ArrowRight />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 text-[12px] text-muted-foreground">
          <p>FlowPilot — a portfolio project. All data is fictional.</p>
          <p>Next.js · tRPC · Prisma · PostgreSQL + pgvector</p>
        </div>
      </footer>
    </div>
  );
}
