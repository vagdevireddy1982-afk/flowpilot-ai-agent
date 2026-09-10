"use client";

import {
  BookOpen,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { api } from "@/trpc/client";

export function KnowledgeWorkspace({ canWrite }: { canWrite: boolean }) {
  const utils = api.useUtils();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const documents = api.knowledge.list.useQuery();
  const stats = api.knowledge.stats.useQuery();
  const search = api.knowledge.search.useQuery(
    { query: submittedQuery, limit: 6 },
    { enabled: submittedQuery.length >= 2 },
  );

  const reindex = api.knowledge.reindex.useMutation({
    onSuccess: async (result) => {
      toast.success(`Re-indexed into ${result.chunkCount} chunks`);
      await utils.knowledge.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = api.knowledge.delete.useMutation({
    onSuccess: async (result) => {
      toast.success(`Deleted “${result.title}”`);
      await utils.knowledge.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  async function upload(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/knowledge/upload", { method: "POST", body });
      const payload = (await response.json()) as { error?: string; chunkCount?: number };

      if (!response.ok) {
        toast.error(payload.error ?? "The upload failed.");
        return;
      }
      toast.success(`Indexed into ${payload.chunkCount ?? 0} chunks`);
      await utils.knowledge.invalidate();
    } catch {
      toast.error("The upload could not be completed. Check your connection and try again.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Documents" value={stats.data?.documents ?? 0} />
        <StatTile label="Indexed chunks" value={stats.data?.chunks ?? 0} />
        <StatTile label="Ready" value={stats.data?.ready ?? 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Semantic search</CardTitle>
          <CardDescription>
            Exactly the retrieval the agent runs — same embeddings, same ranking, same relevance
            floor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setSubmittedQuery(query.trim());
            }}
          >
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="e.g. how long do customers have to request a refund?"
                className="pl-8"
              />
            </div>
            <Button type="submit" disabled={query.trim().length < 2}>
              Search
            </Button>
          </form>

          {submittedQuery && search.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : search.data ? (
            search.data.insufficient ? (
              <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]">
                Nothing in the knowledge base is relevant enough to answer that. The agent would
                tell the user it cannot answer rather than guessing.
              </p>
            ) : (
              <div className="space-y-2">
                {search.data.results.map((result) => (
                  <div key={result.chunkId} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="size-3.5 text-muted-foreground" />
                      <span className="text-[13px] font-medium">{result.documentTitle}</span>
                      {result.page ? (
                        <span className="text-[12px] text-muted-foreground">page {result.page}</span>
                      ) : null}
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                        score {result.score.toFixed(3)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] whitespace-pre-wrap text-muted-foreground">
                      {result.content.slice(0, 420)}
                      {result.content.length > 420 ? "…" : ""}
                    </p>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  Retrieved via the {search.data.store} vector store.
                </p>
              </div>
            )
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Documents</CardTitle>
            <CardDescription>PDF, Markdown and plain text are extracted and indexed on upload.</CardDescription>
          </div>
          {canWrite ? (
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <Button size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
                {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                {uploading ? "Indexing…" : "Upload document"}
              </Button>
            </>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {documents.isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-full" />
              ))}
            </div>
          ) : documents.error ? (
            <ErrorState message={documents.error.message} onRetry={() => documents.refetch()} />
          ) : documents.data.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No documents indexed"
              description="Upload a policy document and the agent will start citing it."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Chunks</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  {canWrite ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.data.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell>
                      <span className="font-medium">{document.title}</span>
                      <span className="block text-[12px] text-muted-foreground">
                        {document.filename}
                        {document.error ? ` · ${document.error}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={document.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{document.chunkCount}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {(document.sizeBytes / 1024).toFixed(1)} KB
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(document.createdAt)}
                      {document.uploadedBy ? ` · ${document.uploadedBy.name}` : ""}
                    </TableCell>
                    {canWrite ? (
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Re-index"
                          disabled={reindex.isPending}
                          onClick={() => reindex.mutate({ id: document.id })}
                        >
                          <RefreshCw />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Delete"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate({ id: document.id })}
                        >
                          <Trash2 className="text-destructive" />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}
