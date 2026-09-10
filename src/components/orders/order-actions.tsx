"use client";

import { Ban, Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/utils";
import { api } from "@/trpc/client";

interface OrderActionsProps {
  orderId: string;
  reference: string;
  status: string;
  paymentStatus: string;
  currency: string;
  totalAmountMinor: number;
  refundedAmountMinor: number;
  canCancel: boolean;
  canRefund: boolean;
}

const CANCELLABLE = ["PENDING", "PROCESSING", "SHIPPED"];

/**
 * Manual equivalents of the agent's high-risk tools. Both use the same service
 * functions and produce the same audit records; the difference is that a human
 * initiated them directly, so no approval record is created.
 */
export function OrderActions(props: OrderActionsProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"cancel" | "refund" | null>(null);
  const [reason, setReason] = useState("");
  const refundable = props.totalAmountMinor - props.refundedAmountMinor;
  const [amount, setAmount] = useState((refundable / 100).toFixed(2));

  const cancel = api.order.cancel.useMutation({
    onSuccess: () => {
      toast.success(`Order ${props.reference} cancelled`);
      setDialog(null);
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const refund = api.order.refund.useMutation({
    onSuccess: (result) => {
      toast.success(
        `Refunded ${formatMoney(result.refund.amountMinor, result.refund.currency)} (${result.refund.reference})`,
      );
      setDialog(null);
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const cancellable = CANCELLABLE.includes(props.status);
  const canIssueRefund = refundable > 0 && ["PAID", "PARTIALLY_REFUNDED"].includes(props.paymentStatus);

  if (!props.canCancel && !props.canRefund) return null;

  return (
    <>
      {props.canCancel ? (
        <Button
          size="sm"
          variant="outline"
          disabled={!cancellable}
          title={cancellable ? undefined : `An order that is ${props.status.toLowerCase()} cannot be cancelled`}
          onClick={() => {
            setReason("");
            setDialog("cancel");
          }}
        >
          <Ban /> Cancel order
        </Button>
      ) : null}

      {props.canRefund ? (
        <Button
          size="sm"
          variant="outline"
          disabled={!canIssueRefund}
          title={canIssueRefund ? undefined : "Nothing left to refund on this order"}
          onClick={() => {
            setReason("");
            setAmount((refundable / 100).toFixed(2));
            setDialog("refund");
          }}
        >
          <RotateCcw /> Issue refund
        </Button>
      ) : null}

      <Dialog open={dialog === "cancel"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel order {props.reference}?</DialogTitle>
            <DialogDescription>
              The order is marked cancelled and an event is added to its timeline. This cannot be
              undone from FlowPilot.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Input
              id="cancel-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Customer no longer needs the item"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Keep order
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending || reason.trim().length < 3}
              onClick={() => cancel.mutate({ id: props.orderId, reason: reason.trim() })}
            >
              {cancel.isPending ? <Loader2 className="animate-spin" /> : null}
              Cancel order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "refund"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refund order {props.reference}</DialogTitle>
            <DialogDescription>
              Up to {formatMoney(refundable, props.currency)} can be refunded against this order.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="refund-amount">Amount ({props.currency})</Label>
              <Input
                id="refund-amount"
                type="number"
                step="0.01"
                min="0.01"
                max={(refundable / 100).toFixed(2)}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="refund-reason">Reason</Label>
              <Input
                id="refund-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Delivery delay beyond SLA"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={refund.isPending || reason.trim().length < 3 || Number(amount) <= 0}
              onClick={() =>
                refund.mutate({
                  id: props.orderId,
                  amountMinor: Math.round(Number(amount) * 100),
                  reason: reason.trim(),
                })
              }
            >
              {refund.isPending ? <Loader2 className="animate-spin" /> : null}
              Refund {formatMoney(Math.round(Number(amount) * 100) || 0, props.currency)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
