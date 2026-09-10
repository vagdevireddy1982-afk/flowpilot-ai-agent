import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { TicketsTable } from "@/components/tickets/tickets-table";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";

export const metadata: Metadata = { title: "Support tickets" };

export default async function TicketsPage() {
  const session = await auth();
  const canWrite = session?.user ? hasPermission(session.user.role, "ticket:write") : false;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Support tickets"
        description="The queue the agent files into, and the team works from."
      />
      <TicketsTable canWrite={canWrite} />
    </div>
  );
}
