"use client";

import { MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn, relativeTime } from "@/lib/utils";
import { api } from "@/trpc/client";

export interface ConversationSummary {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: Date;
  _count: { messages: number };
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onChanged,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onChanged: (deletedId?: string) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const rename = api.agent.renameConversation.useMutation({
    onSuccess: () => {
      setRenamingId(null);
      onChanged();
    },
    onError: (error) => toast.error(error.message),
  });

  const pin = api.agent.pinConversation.useMutation({
    onSuccess: () => onChanged(),
    onError: (error) => toast.error(error.message),
  });

  const remove = api.agent.deleteConversation.useMutation({
    onSuccess: (result) => {
      toast.success("Conversation deleted");
      onChanged(result.id);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button className="w-full justify-start" size="sm" onClick={onNew}>
          <Plus /> New conversation
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
            No conversations yet.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                {renamingId === conversation.id ? (
                  <form
                    className="p-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!draftTitle.trim()) return;
                      rename.mutate({ id: conversation.id, title: draftTitle.trim() });
                    }}
                  >
                    <Input
                      autoFocus
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onBlur={() => setRenamingId(null)}
                      className="h-8 text-[13px]"
                    />
                  </form>
                ) : (
                  <div
                    className={cn(
                      "group flex items-center gap-1 rounded-md pr-1 transition-colors",
                      activeId === conversation.id ? "bg-sidebar-accent" : "hover:bg-muted/70",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(conversation.id)}
                      className="min-w-0 flex-1 px-2 py-1.5 text-left"
                    >
                      <span className="flex items-center gap-1.5">
                        {conversation.pinned ? (
                          <Pin className="size-3 shrink-0 text-muted-foreground" />
                        ) : (
                          <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate text-[13px]">{conversation.title}</span>
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {conversation._count.messages} messages ·{" "}
                        {relativeTime(conversation.updatedAt)}
                      </span>
                    </button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                        >
                          <MoreHorizontal />
                          <span className="sr-only">Conversation actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setRenamingId(conversation.id);
                            setDraftTitle(conversation.title);
                          }}
                        >
                          <Pencil /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            pin.mutate({ id: conversation.id, pinned: !conversation.pinned })
                          }
                        >
                          {conversation.pinned ? <PinOff /> : <Pin />}
                          {conversation.pinned ? "Unpin" : "Pin"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => remove.mutate({ id: conversation.id })}
                        >
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
