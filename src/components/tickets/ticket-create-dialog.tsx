"use client";

import { Loader2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { titleCase } from "@/lib/utils";
import { api } from "@/trpc/client";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const CATEGORIES = ["BILLING", "DELIVERY", "PRODUCT", "ACCOUNT", "OTHER"] as const;

export function TicketCreateDialog({
  open,
  onOpenChange,
  customerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId?: string;
}) {
  const utils = api.useUtils();
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(customerId ?? "");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("MEDIUM");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("OTHER");

  const debouncedSearch = useDebouncedValue(customerSearch, 250);
  const customers = api.customer.list.useQuery(
    { search: debouncedSearch || undefined, limit: 8 },
    { enabled: open && !customerId },
  );

  const create = api.ticket.create.useMutation({
    onSuccess: async (ticket) => {
      toast.success(`Ticket ${ticket.reference} created`);
      setSubject("");
      setDescription("");
      await utils.ticket.list.invalidate();
      onOpenChange(false);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New support ticket</DialogTitle>
          <DialogDescription>
            The same operation the agent performs with its createSupportTicket tool.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedCustomer) {
              toast.error("Pick a customer first.");
              return;
            }
            create.mutate({
              customerId: selectedCustomer,
              subject,
              description,
              priority,
              category,
            });
          }}
        >
          {customerId ? null : (
            <div className="space-y-1.5">
              <Label htmlFor="ticket-customer">Customer</Label>
              <Input
                id="ticket-customer"
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder="Search customers by name or email…"
              />
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border p-1">
                {(customers.data?.items ?? []).map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => setSelectedCustomer(customer.id)}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] ${
                      selectedCustomer === customer.id ? "bg-primary/10 text-primary" : "hover:bg-muted"
                    }`}
                  >
                    <span className="truncate">{customer.name}</span>
                    <span className="ml-2 shrink-0 font-mono text-[11px] text-muted-foreground">
                      {customer.reference}
                    </span>
                  </button>
                ))}
                {customers.data && customers.data.items.length === 0 ? (
                  <p className="px-2 py-2 text-[12px] text-muted-foreground">No customers found.</p>
                ) : null}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ticket-subject">Subject</Label>
            <Input
              id="ticket-subject"
              required
              minLength={3}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Order has not moved since dispatch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ticket-description">Description</Label>
            <Textarea
              id="ticket-description"
              required
              minLength={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What the customer reported and what has been tried so far."
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value as (typeof PRIORITIES)[number])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {titleCase(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={category}
                onValueChange={(value) => setCategory(value as (typeof CATEGORIES)[number])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {titleCase(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              Create ticket
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
