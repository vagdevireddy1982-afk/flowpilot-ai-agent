import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await auth();
  const role = session?.user.role;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Settings"
        description="Your profile, the active AI configuration, and the controls that govern what the agent may do on its own."
      />
      <SettingsWorkspace
        canWrite={role ? hasPermission(role, "settings:write") : false}
        canManageUsers={role ? hasPermission(role, "user:manage") : false}
      />
    </div>
  );
}
