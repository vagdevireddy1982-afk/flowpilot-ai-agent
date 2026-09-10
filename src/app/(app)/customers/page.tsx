import type { Metadata } from "next";
import { CustomersTable } from "@/components/customers/customers-table";
import { PageHeader } from "@/components/shared/page-header";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  const session = await auth();
  const canWrite = session?.user ? hasPermission(session.user.role, "customer:write") : false;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Customers"
        description="Every account the agent and the team can act on."
      />
      <CustomersTable canWrite={canWrite} />
    </div>
  );
}
