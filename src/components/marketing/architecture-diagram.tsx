import { cn } from "@/lib/utils";

const STAGES = [
  { label: "Operator", detail: "Natural-language request", tone: "neutral" },
  { label: "Agent loop", detail: "Context + tool selection", tone: "primary" },
  { label: "Validation", detail: "Zod schema · permissions", tone: "primary" },
  { label: "Risk engine", detail: "LOW / MEDIUM / HIGH", tone: "warning" },
  { label: "Approval gate", detail: "Human decision on HIGH", tone: "warning" },
  { label: "Service layer", detail: "Business rules", tone: "primary" },
  { label: "PostgreSQL", detail: "Records + pgvector", tone: "neutral" },
  { label: "Audit log", detail: "Immutable record", tone: "success" },
] as const;

const TONES = {
  neutral: "border-border bg-surface",
  primary: "border-primary/30 bg-primary/5",
  warning: "border-warning/40 bg-warning/10",
  success: "border-success/40 bg-success/10",
} as const;

/**
 * Static request-flow diagram for the landing page. Deliberately plain HTML —
 * it stays legible in both themes and needs no charting dependency.
 */
export function ArchitectureDiagram() {
  return (
    <div className="panel overflow-x-auto p-5">
      <ol className="flex min-w-max items-stretch gap-2">
        {STAGES.map((stage, index) => (
          <li key={stage.label} className="flex items-stretch gap-2">
            <div
              className={cn(
                "flex w-36 flex-col justify-center rounded-lg border px-3 py-3",
                TONES[stage.tone],
              )}
            >
              <span className="text-[13px] font-medium">{stage.label}</span>
              <span className="mt-0.5 text-[11px] text-muted-foreground">{stage.detail}</span>
            </div>
            {index < STAGES.length - 1 ? (
              <span className="self-center text-muted-foreground" aria-hidden>
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[12px] text-muted-foreground">
        The structured tool result is fed back into the model, which writes the final answer. Nothing
        in this chain lets the model reach the database directly.
      </p>
    </div>
  );
}
