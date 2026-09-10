import type { Metadata } from "next";
import { ActivityLog } from "@/components/activity/activity-log";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Activity log"
        description="Every agent action, human decision and outbound message, with the inputs and outputs that produced it."
      />
      <ActivityLog defaultTab={tab === "escalations" || tab === "emails" ? tab : "audit"} />
    </div>
  );
}
