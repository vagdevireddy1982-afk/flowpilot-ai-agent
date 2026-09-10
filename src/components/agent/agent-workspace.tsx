"use client";

import {
  AlertCircle,
  Bot,
  CornerDownLeft,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCw,
  Sparkles,
  User,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ApprovalCard, type ApprovalCardData } from "@/components/agent/approval-card";
import { Citations } from "@/components/agent/citations";
import { ConversationList } from "@/components/agent/conversation-list";
import { Markdown } from "@/components/agent/markdown";
import { ToolCallTrace } from "@/components/agent/tool-call-trace";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn, initials } from "@/lib/utils";
import { api } from "@/trpc/client";
import type { AssistantMessageMetadata } from "@/types/agent";

const SUGGESTIONS = [
  "Show me order ORD-1004.",
  "Find customer Priya Sharma.",
  "Which orders are delayed right now?",
  "According to our refund policy, can a delivered order be refunded?",
  "Create a high priority ticket for Priya Sharma because her order is delayed.",
  "Refund order ORD-1004.",
];

export function AgentWorkspace({ userName }: { userName: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = api.useUtils();

  const [activeId, setActiveId] = useState<string | null>(searchParams.get("c"));
  const [draft, setDraft] = useState(searchParams.get("q") ?? "");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const conversations = api.agent.conversations.useQuery();
  const conversation = api.agent.conversation.useQuery(
    { id: activeId ?? "" },
    { enabled: Boolean(activeId) },
  );
  const approvals = api.approval.list.useQuery({ limit: 50 });

  const createConversation = api.agent.createConversation.useMutation();

  const sendMessage = api.agent.sendMessage.useMutation({
    onSuccess: async (result) => {
      setPendingMessage(null);
      setLastFailedMessage(null);
      await Promise.all([
        utils.agent.conversation.invalidate({ id: result.conversationId }),
        utils.agent.conversations.invalidate(),
        utils.approval.list.invalidate(),
      ]);
      if (result.status === "awaiting_approval") {
        toast.warning("The agent needs your approval before it can continue.");
      }
    },
    onError: (error, variables) => {
      setPendingMessage(null);
      setLastFailedMessage(variables.message);
      toast.error(error.message);
    },
  });

  // Keep the URL in sync so a conversation can be linked to and reloaded.
  useEffect(() => {
    if (!activeId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("c", activeId);
    params.delete("q");
    router.replace(`/agent?${params.toString()}`, { scroll: false });
    // Only re-run when the selected conversation changes.

  }, [activeId]);

  // Select the most recent conversation on first load.
  useEffect(() => {
    if (activeId || !conversations.data || conversations.data.length === 0) return;
    setActiveId(conversations.data[0]!.id);
  }, [activeId, conversations.data]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [conversation.data?.messages.length, pendingMessage]);

  const approvalsById = useMemo(() => {
    const map = new Map<string, ApprovalCardData>();
    for (const approval of approvals.data ?? []) {
      map.set(approval.id, {
        id: approval.id,
        toolName: approval.toolName,
        summary: approval.summary,
        riskLevel: approval.riskLevel,
        status: approval.status,
        canDecide: approval.canDecide,
        decisionNote: approval.decisionNote,
        decidedByName: approval.decidedBy?.name ?? null,
      });
    }
    return map;
  }, [approvals.data]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sendMessage.isPending) return;

      let conversationId = activeId;
      if (!conversationId) {
        const created = await createConversation.mutateAsync({ title: trimmed.slice(0, 70) });
        conversationId = created.id;
        setActiveId(created.id);
        await utils.agent.conversations.invalidate();
      }

      setDraft("");
      setPendingMessage(trimmed);
      sendMessage.mutate({ conversationId, message: trimmed });
    },
    [activeId, createConversation, sendMessage, utils],
  );

  const messages = conversation.data?.messages ?? [];
  const toolCalls = conversation.data?.toolCalls ?? [];

  /** Tool calls are shown above the assistant message they produced. */
  const callsForMessage = (index: number) => {
    const current = messages[index]!;
    const previous = messages[index - 1];
    return toolCalls.filter((call) => {
      const at = new Date(call.createdAt).getTime();
      const upper = new Date(current.createdAt).getTime();
      const lower = previous ? new Date(previous.createdAt).getTime() : 0;
      return at > lower && at <= upper;
    });
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={cn(
          "hidden w-64 shrink-0 border-r bg-sidebar md:flex md:flex-col",
          !sidebarOpen && "md:hidden",
        )}
      >
        <ConversationList
          conversations={conversations.data ?? []}
          activeId={activeId}
          onSelect={setActiveId}
          onNew={async () => {
            const created = await createConversation.mutateAsync({});
            setActiveId(created.id);
            await utils.agent.conversations.invalidate();
          }}
          onChanged={async (deletedId) => {
            await utils.agent.conversations.invalidate();
            if (deletedId && deletedId === activeId) setActiveId(null);
          }}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden md:inline-flex"
            onClick={() => setSidebarOpen((open) => !open)}
          >
            {sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            <span className="sr-only">Toggle conversation list</span>
          </Button>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium">
              {conversation.data?.conversation.title ?? "AI Agent"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Tool calls, approvals and citations are recorded for every turn.
            </p>
          </div>
        </div>

        <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
            {conversation.isPending && activeId ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-2/3" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : conversation.error ? (
              <ErrorState
                message={conversation.error.message}
                onRetry={() => conversation.refetch()}
              />
            ) : messages.length === 0 && !pendingMessage ? (
              <WelcomeState userName={userName} onPick={(text) => send(text)} />
            ) : (
              messages.map((message, index) => {
                const metadata = (message.metadata ?? {}) as AssistantMessageMetadata;
                const approval = metadata.awaitingApprovalId
                  ? approvalsById.get(metadata.awaitingApprovalId)
                  : undefined;

                return (
                  <div key={message.id} className="space-y-2">
                    {message.role === "ASSISTANT" ? (
                      <ToolCallTrace calls={callsForMessage(index)} />
                    ) : null}

                    <MessageBubble role={message.role} userName={userName}>
                      <Markdown content={message.content} />

                      {metadata.citations?.length ? (
                        <Citations citations={metadata.citations} />
                      ) : null}

                      {approval ? (
                        <ApprovalCard
                          approval={approval}
                          onDecided={async () => {
                            await Promise.all([
                              utils.agent.conversation.invalidate({ id: activeId ?? "" }),
                              utils.approval.list.invalidate(),
                            ]);
                          }}
                        />
                      ) : null}

                      {metadata.escalated ? (
                        <Badge variant="warning" className="mt-3">
                          Escalated to a human specialist
                        </Badge>
                      ) : null}

                      {message.role === "ASSISTANT" && metadata.latencyMs ? (
                        <p className="mt-2.5 text-[11px] text-muted-foreground">
                          {metadata.model ?? "model"} · {metadata.latencyMs} ms
                          {metadata.usedKnowledge ? " · knowledge-grounded" : ""}
                        </p>
                      ) : null}
                    </MessageBubble>
                  </div>
                );
              })
            )}

            {pendingMessage ? (
              <>
                <MessageBubble role="USER" userName={userName}>
                  <p>{pendingMessage}</p>
                </MessageBubble>
                <MessageBubble role="ASSISTANT" userName={userName}>
                  <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Thinking, selecting tools and checking permissions…
                  </span>
                </MessageBubble>
              </>
            ) : null}

            {lastFailedMessage ? (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px]">
                <AlertCircle className="size-4 shrink-0 text-destructive" />
                <span className="min-w-0 flex-1">That turn failed to complete.</span>
                <Button size="sm" variant="outline" onClick={() => send(lastFailedMessage)}>
                  <RotateCw /> Retry
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="border-t bg-background px-4 py-3">
          <form
            className="mx-auto w-full max-w-3xl"
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft);
            }}
          >
            <div className="relative">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send(draft);
                  }
                }}
                placeholder="Ask about an order, a customer, a policy — or ask the agent to do something."
                className="min-h-[52px] resize-none pr-24"
                rows={2}
                disabled={sendMessage.isPending}
              />
              <Button
                type="submit"
                size="sm"
                className="absolute right-2 bottom-2"
                disabled={sendMessage.isPending || draft.trim().length === 0}
              >
                {sendMessage.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <CornerDownLeft />
                )}
                Send
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Enter to send · Shift+Enter for a new line. High-risk actions always stop for your
              approval.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  userName,
  children,
}: {
  role: string;
  userName: string;
  children: React.ReactNode;
}) {
  const isUser = role === "USER";
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
          isUser ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
        )}
      >
        {isUser ? initials(userName) || <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </span>
      <div
        className={cn(
          "min-w-0 max-w-[calc(100%-3rem)] rounded-xl px-3.5 py-2.5 text-[13px]",
          isUser ? "bg-primary text-primary-foreground" : "border bg-surface",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function WelcomeState({
  userName,
  onPick,
}: {
  userName: string;
  onPick: (text: string) => void;
}) {
  return (
    <div className="py-6">
      <EmptyState
        icon={Sparkles}
        title={`Hello ${userName.split(" ")[0]} — what do you need?`}
        description="The agent can look things up, answer from your policy documents, and take real actions once you approve them."
      />
      <div className="mx-auto mt-4 grid max-w-2xl gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onPick(suggestion)}
            className="rounded-lg border bg-surface px-3 py-2.5 text-left text-[13px] transition-colors hover:border-ring/40 hover:bg-muted"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
