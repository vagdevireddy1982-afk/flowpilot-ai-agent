import type { Metadata } from "next";
import { ApprovalsQueue } from "@/components/approvals/approvals-queue";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Approvals"
        description="High-risk actions the agent proposed. Nothing here has run — approving is what executes it."
      />
      <ApprovalsQueue />
    </div>
  );
}
