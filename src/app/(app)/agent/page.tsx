import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AgentWorkspace } from "@/components/agent/agent-workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";

export const metadata: Metadata = { title: "AI Agent" };

export default async function AgentPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // VIEWERs can read every record but must not be able to trigger tools.
  if (!hasPermission(session.user.role, "agent:use")) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <div className="panel p-6">
          <h1 className="text-lg font-semibold">Agent access is restricted</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Your role ({session.user.role}) has read-only access. Ask an administrator for the
            Operator role to use the AI agent.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<Skeleton className="m-4 h-[70vh]" />}>
      <AgentWorkspace userName={session.user.name ?? "Operator"} />
    </Suspense>
  );
}
