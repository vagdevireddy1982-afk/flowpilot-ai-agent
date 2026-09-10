"use client";

import { Bot, Building2, Loader2, ShieldCheck, User } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { titleCase } from "@/lib/utils";
import { api } from "@/trpc/client";

export function SettingsWorkspace({ canWrite, canManageUsers }: { canWrite: boolean; canManageUsers: boolean }) {
  return (
    <Tabs defaultValue="profile">
      <TabsList>
        <TabsTrigger value="profile">
          <User /> Profile
        </TabsTrigger>
        <TabsTrigger value="ai">
          <Bot /> AI provider
        </TabsTrigger>
        <TabsTrigger value="organization">
          <Building2 /> Organization
        </TabsTrigger>
        <TabsTrigger value="roles">
          <ShieldCheck /> Roles
        </TabsTrigger>
      </TabsList>

      <TabsContent value="profile">
        <ProfileTab />
      </TabsContent>
      <TabsContent value="ai">
        <ProviderTab />
      </TabsContent>
      <TabsContent value="organization">
        <OrganizationTab canWrite={canWrite} />
      </TabsContent>
      <TabsContent value="roles">
        <RolesTab canManageUsers={canManageUsers} />
      </TabsContent>
    </Tabs>
  );
}

function ProfileTab() {
  const me = api.settings.me.useQuery();
  const utils = api.useUtils();
  const [name, setName] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState<string | null>(null);

  const update = api.settings.updateProfile.useMutation({
    onSuccess: async () => {
      toast.success("Profile updated");
      await utils.settings.me.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  if (me.isPending) return <Skeleton className="h-64 w-full" />;
  if (!me.data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your profile</CardTitle>
        <CardDescription>
          Signed in as {me.data.email}. Role changes are made by an administrator.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              value={name ?? me.data.name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-title">Job title</Label>
            <Input
              id="profile-title"
              value={jobTitle ?? ""}
              placeholder="Operations Specialist"
              onChange={(event) => setJobTitle(event.target.value)}
            />
          </div>
        </div>

        <div>
          <p className="text-[13px] font-medium">Your permissions</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {me.data.permissions.map((permission) => (
              <Badge key={permission} variant="neutral" className="font-mono">
                {permission}
              </Badge>
            ))}
          </div>
        </div>

        <Button
          size="sm"
          disabled={update.isPending || (name === null && jobTitle === null)}
          onClick={() =>
            update.mutate({
              name: name ?? undefined,
              jobTitle: jobTitle === null ? undefined : jobTitle || null,
            })
          }
        >
          {update.isPending ? <Loader2 className="animate-spin" /> : null}
          Save profile
        </Button>
      </CardContent>
    </Card>
  );
}

function ProviderTab() {
  const runtime = api.settings.runtime.useQuery();
  const capabilities = api.agent.capabilities.useQuery();

  if (runtime.isPending) return <Skeleton className="h-64 w-full" />;
  if (!runtime.data) return null;

  const config = runtime.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>AI provider</CardTitle>
          <CardDescription>
            Read-only: these values come from environment variables. Secrets are never sent to the
            browser — only whether one is configured.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Configured provider" value={config.configuredProvider} />
          <Field
            label="Active provider"
            value={config.activeProvider}
            hint={
              config.configuredProvider === "openai" && config.activeProvider === "mock"
                ? "Falling back to mock because LLM_API_KEY is not set"
                : undefined
            }
          />
          <Field label="Model" value={config.model} />
          <Field label="Embedding model" value={config.embeddingModel} />
          <Field label="Base URL" value={config.baseUrl ?? "—"} />
          <Field label="API key" value={config.apiKeyConfigured ? "Configured" : "Not configured"} />
          <Field label="Streaming" value={config.supportsStreaming ? "Supported" : "Not supported"} />
          <Field
            label="Vector store"
            value={`${config.vectorStoreMode}${config.pgvectorAvailable ? " · pgvector available" : " · pgvector unavailable"}`}
          />
          <Field label="Email provider" value={config.emailProvider} />
          <Field label="Email from" value={config.emailFrom} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tools available to your role</CardTitle>
          <CardDescription>
            The agent can call nothing outside this list. Risk levels decide which need approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {capabilities.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            (capabilities.data?.tools ?? []).map((tool) => (
              <div key={tool.name} className="flex flex-wrap items-start gap-2 rounded-lg border p-2.5">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
                  {tool.name}
                </code>
                <StatusBadge status={tool.risk} />
                <Badge variant="neutral" className="font-mono">
                  {tool.permission}
                </Badge>
                <p className="w-full text-[12px] text-muted-foreground">{tool.description}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OrganizationTab({ canWrite }: { canWrite: boolean }) {
  const organization = api.settings.organization.useQuery();
  const utils = api.useUtils();
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  const update = api.settings.updateOrganization.useMutation({
    onSuccess: async () => {
      toast.success("Settings saved");
      setDraft({});
      await utils.settings.organization.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  if (organization.isPending) return <Skeleton className="h-64 w-full" />;
  if (!organization.data) return null;

  const settings = { ...organization.data, ...draft } as typeof organization.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization</CardTitle>
        <CardDescription>
          These settings change how the agent behaves — including which actions stop for approval.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Organization name</Label>
            <Input
              id="org-name"
              disabled={!canWrite}
              value={settings.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-email">Support email</Label>
            <Input
              id="org-email"
              type="email"
              disabled={!canWrite}
              value={settings.supportEmail}
              onChange={(event) => setDraft({ ...draft, supportEmail: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Default currency</Label>
            <Select
              disabled={!canWrite}
              value={settings.defaultCurrency}
              onValueChange={(value) => setDraft({ ...draft, defaultCurrency: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["INR", "USD", "EUR", "GBP"].map((currency) => (
                  <SelectItem key={currency} value={currency}>
                    {currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-context">Replayed conversation turns</Label>
            <Input
              id="org-context"
              type="number"
              min={4}
              max={40}
              disabled={!canWrite}
              value={settings.maxContextMessages}
              onChange={(event) =>
                setDraft({ ...draft, maxContextMessages: Number(event.target.value) })
              }
            />
          </div>
        </div>

        <div className="space-y-3 border-t pt-4">
          <ToggleRow
            label="Auto-approve medium-risk actions"
            description="When off, creating or updating a ticket also stops for confirmation. High-risk actions always require approval."
            checked={settings.autoApproveMediumRisk}
            disabled={!canWrite}
            onChange={(value) => setDraft({ ...draft, autoApproveMediumRisk: value })}
          />
          <ToggleRow
            label="Notify on approval requests"
            description="Surface pending approvals in the sidebar counter."
            checked={settings.notifyOnApproval}
            disabled={!canWrite}
            onChange={(value) => setDraft({ ...draft, notifyOnApproval: value })}
          />
          <ToggleRow
            label="Notify on escalations"
            description="Highlight escalations on the dashboard."
            checked={settings.notifyOnEscalation}
            disabled={!canWrite}
            onChange={(value) => setDraft({ ...draft, notifyOnEscalation: value })}
          />
        </div>

        {canWrite ? (
          <Button
            size="sm"
            disabled={update.isPending || Object.keys(draft).length === 0}
            onClick={() => update.mutate(draft)}
          >
            {update.isPending ? <Loader2 className="animate-spin" /> : null}
            Save settings
          </Button>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Your role can view these settings but not change them.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RolesTab({ canManageUsers }: { canManageUsers: boolean }) {
  const roles = api.settings.roles.useQuery();
  const users = api.settings.users.useQuery();
  const utils = api.useUtils();

  const updateRole = api.settings.updateUserRole.useMutation({
    onSuccess: async () => {
      toast.success("Role updated");
      await utils.settings.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  if (roles.isPending || users.isPending) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
          <CardDescription>
            Permissions are declared once in code and enforced on every API call and tool execution.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(roles.data ?? []).map((role) => (
            <div key={role.role} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={role.role === "ADMIN" ? "default" : "neutral"}>{role.role}</Badge>
                <span className="text-[12px] text-muted-foreground">
                  {role.userCount} user{role.userCount === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] text-muted-foreground">{role.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {role.permissions.map((permission) => (
                  <Badge key={permission} variant="neutral" className="font-mono">
                    {permission}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>
            {canManageUsers
              ? "Changing a role takes effect on the user's next request."
              : "Only administrators can change roles."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(users.data ?? []).map((user) => (
            <div key={user.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-2.5">
              <span
                className="flex size-7 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: user.avatarColor }}
              >
                {user.name
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{user.name}</p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {user.email}
                  {user.jobTitle ? ` · ${user.jobTitle}` : ""}
                </p>
              </div>
              <div className="ml-auto">
                {canManageUsers ? (
                  <Select
                    value={user.role}
                    onValueChange={(value) =>
                      updateRole.mutate({
                        userId: user.id,
                        role: value as "ADMIN" | "AGENT" | "VIEWER",
                      })
                    }
                  >
                    <SelectTrigger className="w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["ADMIN", "AGENT", "VIEWER"].map((role) => (
                        <SelectItem key={role} value={role}>
                          {titleCase(role)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="neutral">{user.role}</Badge>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 font-mono text-[13px] break-all">{value}</p>
      {hint ? <p className="mt-1 text-[12px] text-warning">{hint}</p> : null}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{label}</p>
        <p className="text-[12px] text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
