import { ArrowLeft, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderActions } from "@/components/orders/order-actions";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils";
import { createServerCaller } from "@/server/api/root";

export const metadata: Metadata = { title: "Order" };
export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await createServerCaller();
  const session = await auth();

  const detail = await caller.order.detail({ id }).catch(() => null);
  if (!detail) notFound();

  const { order, events, refunds } = detail;
  const role = session?.user.role;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/orders">
          <ArrowLeft /> All orders
        </Link>
      </Button>

      <PageHeader
        title={order.reference}
        description={`Placed ${formatDate(order.placedAt)} by ${order.customer.name}`}
        actions={
          <>
            <Button asChild size="sm" variant="ghost">
              <Link href={`/agent?q=${encodeURIComponent(`Show me order ${order.reference}`)}`}>
                <Sparkles /> Ask the agent
              </Link>
            </Button>
            <OrderActions
              orderId={order.id}
              reference={order.reference}
              status={order.status}
              paymentStatus={order.paymentStatus}
              currency={order.currency}
              totalAmountMinor={order.totalAmountMinor}
              refundedAmountMinor={order.refundedAmountMinor}
              canCancel={role ? hasPermission(role, "order:cancel") : false}
              canRefund={role ? hasPermission(role, "order:refund") : false}
            />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="font-mono text-[12px] text-muted-foreground">
                      {item.sku}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(item.unitPriceMinor, order.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(item.unitPriceMinor * item.quantity, order.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t px-3 py-3 text-[13px]">
              <span className="text-muted-foreground">
                {order.refundedAmountMinor > 0
                  ? `${formatMoney(order.refundedAmountMinor, order.currency)} refunded`
                  : "No refunds against this order"}
              </span>
              <span className="text-base font-semibold tabular-nums">
                {formatMoney(order.totalAmountMinor, order.currency)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-[13px]">
            <Row label="Order">
              <StatusBadge status={order.status} />
            </Row>
            <Row label="Payment">
              <StatusBadge status={order.paymentStatus} />
            </Row>
            <Row label="Delivery">
              <StatusBadge status={order.deliveryStatus} />
            </Row>
            <Row label="Customer">
              <Link href={`/customers/${order.customer.id}`} className="hover:underline">
                {order.customer.name}
              </Link>
            </Row>
            <Row label="Expected">{formatDate(order.expectedDeliveryAt)}</Row>
            <Row label="Delivered">{formatDate(order.deliveredAt)}</Row>
            {order.cancellationReason ? (
              <Row label="Cancelled">{order.cancellationReason}</Row>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
            <CardDescription>Every state change, whoever or whatever caused it.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {events.map((event) => (
                <li key={event.id} className="flex gap-3">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/60" />
                  <div className="min-w-0">
                    <p className="text-[13px]">{event.description}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {event.type} · {event.actorLabel ?? event.actorType} ·{" "}
                      {formatDateTime(event.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Refunds</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {refunds.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No refunds issued.</p>
            ) : (
              refunds.map((refund) => (
                <div key={refund.id} className="rounded-lg border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[12px]">{refund.reference}</span>
                    <StatusBadge status={refund.status} />
                  </div>
                  <p className="mt-1 text-[13px] font-medium tabular-nums">
                    {formatMoney(refund.amountMinor, refund.currency)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {refund.reason} · {formatDateTime(refund.createdAt)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
