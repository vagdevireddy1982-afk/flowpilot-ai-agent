"use client";

import { Bot, Package, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { NAV_SECTIONS } from "@/components/layout/nav-config";
import type { Role } from "@/generated/prisma/enums";
import { hasPermission } from "@/lib/auth/rbac";
import { api } from "@/trpc/client";

/**
 * ⌘K palette. Navigation is instant; customer and order lookups query the API
 * once the operator has typed enough to be searching for something specific.
 */
export function CommandPalette({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Role;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(timer);
  }, [query]);

  const searchEnabled = open && debounced.length >= 2;

  const customers = api.customer.list.useQuery(
    { search: debounced, limit: 5 },
    { enabled: searchEnabled && hasPermission(role, "customer:read") },
  );
  const orders = api.order.list.useQuery(
    { search: debounced, limit: 5 },
    { enabled: searchEnabled && hasPermission(role, "order:read") },
  );

  const go = (href: string) => {
    onOpenChange(false);
    setQuery("");
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search customers and orders, or jump to a page…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No matches found.</CommandEmpty>

        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((item) => hasPermission(role, item.permission));
          if (items.length === 0) return null;
          return (
            <CommandGroup key={section.label} heading={section.label}>
              {items.map((item) => (
                <CommandItem
                  key={item.href}
                  value={`${item.label} ${item.keywords?.join(" ") ?? ""}`}
                  onSelect={() => go(item.href)}
                >
                  <item.icon />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}

        {(customers.data?.items.length ?? 0) > 0 ? (
          <CommandGroup heading="Customers">
            {customers.data!.items.map((customer) => (
              <CommandItem
                key={customer.id}
                value={`customer ${customer.name} ${customer.reference} ${customer.email}`}
                onSelect={() => go(`/customers/${customer.id}`)}
              >
                <Users />
                <span className="truncate">{customer.name}</span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  {customer.reference}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {(orders.data?.items.length ?? 0) > 0 ? (
          <CommandGroup heading="Orders">
            {orders.data!.items.map((order) => (
              <CommandItem
                key={order.id}
                value={`order ${order.reference} ${order.customer.name}`}
                onSelect={() => go(`/orders/${order.id}`)}
              >
                <Package />
                <span className="truncate">
                  {order.reference} · {order.customer.name}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {hasPermission(role, "agent:use") && debounced.length > 2 ? (
          <CommandGroup heading="Agent">
            <CommandItem
              value={`ask agent ${debounced}`}
              onSelect={() => go(`/agent?q=${encodeURIComponent(debounced)}`)}
            >
              <Bot />
              Ask the agent: “{debounced}”
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
