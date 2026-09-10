"use client";

import { Menu, Workflow, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CommandPalette } from "@/components/layout/command-palette";
import { NAV_SECTIONS } from "@/components/layout/nav-config";
import { UserMenu } from "@/components/layout/user-menu";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Role } from "@/generated/prisma/enums";
import { hasPermission } from "@/lib/auth/rbac";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/client";

export interface ShellUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const pendingApprovals = api.approval.list.useQuery(
    { status: "PENDING", limit: 50 },
    { enabled: hasPermission(user.role, "approval:read"), refetchInterval: 60_000 },
  );

  const badges: Record<string, number> = {
    "/approvals": pendingApprovals.data?.length ?? 0,
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r bg-sidebar transition-transform lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between gap-2 border-b px-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Workflow className="size-4" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">FlowPilot</span>
          </Link>
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <X />
            <span className="sr-only">Close navigation</span>
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-4">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => hasPermission(user.role, item.permission));
            if (items.length === 0) return null;
            return (
              <div key={section.label} className="mb-5">
                <p className="px-2.5 pb-1.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                  {section.label}
                </p>
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const active =
                      pathname === item.href || pathname.startsWith(`${item.href}/`);
                    const count = badges[item.href] ?? 0;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={cn(
                            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                            active
                              ? "bg-sidebar-accent text-sidebar-accent-foreground"
                              : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                          )}
                        >
                          <item.icon className="size-4 shrink-0" />
                          <span className="truncate">{item.label}</span>
                          {count > 0 ? (
                            <Badge variant="warning" className="ml-auto">
                              {count}
                            </Badge>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="border-t p-3">
          <UserMenu user={user} />
        </div>
      </aside>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu />
            <span className="sr-only">Open navigation</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="w-full max-w-xs justify-start gap-2 text-muted-foreground"
            onClick={() => setPaletteOpen(true)}
          >
            <span className="truncate">Search or jump to…</span>
            <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">
              ⌘K
            </kbd>
          </Button>

          <div className="ml-auto flex items-center gap-1.5">
            <Badge variant="neutral" className="hidden sm:inline-flex">
              {user.role}
            </Badge>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} role={user.role} />
    </div>
  );
}
