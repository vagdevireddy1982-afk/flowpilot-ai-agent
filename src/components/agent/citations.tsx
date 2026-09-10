"use client";

import { BookOpen, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/trpc/client";
import type { Citation } from "@/types/agent";

/**
 * Citations are rendered from the retrieval result that actually produced the
 * answer — opening one fetches the stored chunk by id, so a source can never
 * point at a passage that does not exist.
 */
export function Citations({ citations }: { citations: Citation[] }) {
  const [openChunkId, setOpenChunkId] = useState<string | null>(null);

  if (citations.length === 0) return null;

  return (
    <>
      <div className="mt-3 border-t pt-2.5">
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          <BookOpen className="size-3" /> Sources
        </p>
        <div className="flex flex-wrap gap-1.5">
          {citations.map((citation) => (
            <button
              key={citation.chunkId}
              type="button"
              onClick={() => setOpenChunkId(citation.chunkId)}
              className="inline-flex items-center gap-1.5 rounded-md border bg-surface px-2 py-1 text-[12px] transition-colors hover:bg-muted"
            >
              <FileText className="size-3 text-muted-foreground" />
              <span className="max-w-[220px] truncate">{citation.documentTitle}</span>
              {citation.page ? (
                <span className="text-muted-foreground">p{citation.page}</span>
              ) : null}
              <span className="font-mono text-[10px] text-muted-foreground">
                {citation.score.toFixed(2)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <CitationDialog
        chunkId={openChunkId}
        onClose={() => setOpenChunkId(null)}
        citation={citations.find((item) => item.chunkId === openChunkId) ?? null}
      />
    </>
  );
}

function CitationDialog({
  chunkId,
  citation,
  onClose,
}: {
  chunkId: string | null;
  citation: Citation | null;
  onClose: () => void;
}) {
  const chunk = api.knowledge.chunk.useQuery({ id: chunkId ?? "" }, { enabled: Boolean(chunkId) });

  return (
    <Dialog open={Boolean(chunkId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{citation?.documentTitle ?? "Source passage"}</DialogTitle>
          <DialogDescription>
            {chunk.data
              ? `${chunk.data.document.filename} · passage ${chunk.data.index + 1}${
                  chunk.data.page ? ` · page ${chunk.data.page}` : ""
                }`
              : "Loading the exact passage used for this answer…"}
          </DialogDescription>
        </DialogHeader>

        {chunk.isPending ? (
          <div className="flex items-center gap-2 py-8 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading passage…
          </div>
        ) : chunk.error ? (
          <p className="py-6 text-[13px] text-destructive">{chunk.error.message}</p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border bg-surface-muted p-4 text-[13px] whitespace-pre-wrap">
            {chunk.data?.content}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
