import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/lib/utils";

type Variant = "default" | "neutral" | "success" | "warning" | "destructive" | "outline";

/**
 * One place that decides how every domain status is coloured, so an OPEN
 * ticket looks the same on the dashboard, the table and the detail page.
 */
const STATUS_VARIANTS: Record<string, Variant> = {
  // Orders
  PENDING: "neutral",
  PROCESSING: "default",
  SHIPPED: "default",
  DELIVERED: "success",
  CANCELLED: "neutral",
  REFUNDED: "warning",
  // Payments
  UNPAID: "warning",
  PAID: "success",
  PARTIALLY_REFUNDED: "warning",
  FAILED: "destructive",
  // Delivery
  NOT_SHIPPED: "neutral",
  IN_TRANSIT: "default",
  DELAYED: "destructive",
  RETURNED: "warning",
  // Tickets
  OPEN: "default",
  IN_PROGRESS: "warning",
  WAITING: "neutral",
  RESOLVED: "success",
  CLOSED: "neutral",
  // Priorities
  LOW: "neutral",
  MEDIUM: "default",
  HIGH: "warning",
  URGENT: "destructive",
  // Approvals & tool calls
  APPROVED: "success",
  REJECTED: "destructive",
  EXPIRED: "neutral",
  AWAITING_APPROVAL: "warning",
  SUCCESS: "success",
  RUNNING: "default",
  // Customers
  ACTIVE: "success",
  INACTIVE: "neutral",
  PROSPECT: "default",
  CHURNED: "warning",
  // Documents / email
  READY: "success",
  SENT: "success",
  QUEUED: "neutral",
  // Escalations
  ACKNOWLEDGED: "warning",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? "neutral"} className={className}>
      {titleCase(status)}
    </Badge>
  );
}

export function RiskBadge({ level }: { level: string }) {
  const variant: Variant =
    level === "HIGH" ? "destructive" : level === "MEDIUM" ? "warning" : "neutral";
  return <Badge variant={variant}>{titleCase(level)} risk</Badge>;
}
