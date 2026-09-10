import type { Metadata } from "next";
import { OrdersTable } from "@/components/orders/orders-table";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ delayed?: string }>;
}) {
  const { delayed } = await searchParams;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Orders"
        description="Order records, payment state and delivery progress across every channel."
      />
      <OrdersTable initialDelayed={delayed === "true"} />
    </div>
  );
}
