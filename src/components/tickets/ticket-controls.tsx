"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { titleCase } from "@/lib/utils";
import { api } from "@/trpc/client";

const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const UNASSIGNED = "__unassigned__";

/** Inline triage controls; each change is a single audited mutation. */
export function TicketControls({
  ticketId,
  status,
  priority,
  assignedToId,
  canWrite,
}: {
  ticketId: string;
  status: string;
  priority: string;
  assignedToId: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const assignees = api.ticket.assignees.useQuery(undefined, { enabled: canWrite });

  const update = api.ticket.update.useMutation({
    onSuccess: () => {
      toast.success("Ticket updated");
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label>Status</Label>
        <Select
          value={status}
          disabled={!canWrite || update.isPending}
          onValueChange={(value) =>
            update.mutate({ id: ticketId, status: value as (typeof STATUSES)[number] })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((option) => (
              <SelectItem key={option} value={option}>
                {titleCase(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Priority</Label>
        <Select
          value={priority}
          disabled={!canWrite || update.isPending}
          onValueChange={(value) =>
            update.mutate({ id: ticketId, priority: value as (typeof PRIORITIES)[number] })
          }
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
        <Label>Assignee</Label>
        <Select
          value={assignedToId ?? UNASSIGNED}
          disabled={!canWrite || update.isPending}
          onValueChange={(value) =>
            update.mutate({ id: ticketId, assignedToId: value === UNASSIGNED ? null : value })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Unassigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
            {(assignees.data ?? []).map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
