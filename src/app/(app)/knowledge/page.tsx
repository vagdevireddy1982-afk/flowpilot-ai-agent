import type { Metadata } from "next";
import { KnowledgeWorkspace } from "@/components/knowledge/knowledge-workspace";
import { PageHeader } from "@/components/shared/page-header";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";

export const metadata: Metadata = { title: "Knowledge base" };

export default async function KnowledgePage() {
  const session = await auth();
  const canWrite = session?.user ? hasPermission(session.user.role, "knowledge:write") : false;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Knowledge base"
        description="Documents are chunked, embedded and stored as vectors. The agent answers policy questions only from what is indexed here."
      />
      <KnowledgeWorkspace canWrite={canWrite} />
    </div>
  );
}
