import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  href?: string;
  tone?: "default" | "warning" | "destructive" | "success";
}) {
  const toneClass = {
    default: "text-primary bg-primary/10",
    warning: "text-warning bg-warning/12",
    destructive: "text-destructive bg-destructive/10",
    success: "text-success bg-success/12",
  }[tone];

  const body = (
    <Card
      className={cn(
        "flex items-start justify-between gap-3 p-4 transition-colors",
        href && "hover:border-ring/40 hover:bg-muted/40",
      )}
    >
      <div className="min-w-0">
        <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        {hint ? <p className="mt-1 truncate text-[12px] text-muted-foreground">{hint}</p> : null}
      </div>
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", toneClass)}>
        <Icon className="size-4" />
      </span>
    </Card>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
