"use client";

import { Loader2, NotebookPen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/trpc/client";

export function CustomerNotesEditor({
  customerId,
  notes,
  canWrite,
}: {
  customerId: string;
  notes: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(notes);

  const update = api.customer.update.useMutation({
    onSuccess: () => {
      toast.success("Notes saved");
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NotebookPen className="size-4 text-muted-foreground" /> Internal notes
        </CardTitle>
        <CardDescription>
          Visible to the team and to the agent. Never shown to the customer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          value={value}
          disabled={!canWrite}
          onChange={(event) => setValue(event.target.value)}
          placeholder={canWrite ? "Add context for the next operator…" : "No notes on file."}
        />
        {canWrite ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setValue(notes)} disabled={value === notes}>
              Reset
            </Button>
            <Button
              size="sm"
              disabled={update.isPending || value === notes}
              onClick={() => update.mutate({ id: customerId, notes: value || null })}
            >
              {update.isPending ? <Loader2 className="animate-spin" /> : null}
              Save notes
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
