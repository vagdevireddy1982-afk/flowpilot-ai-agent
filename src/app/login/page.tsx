import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Workflow } from "lucide-react";
import { LoginForm } from "@/app/login/login-form";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Workflow className="size-4" />
          </span>
          <span className="text-base font-semibold tracking-tight">FlowPilot</span>
        </Link>

        <div className="panel p-6">
          <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Use your operations account to open the agent console.
          </p>
          <LoginForm demoMode={env.DEMO_MODE} />
        </div>

        <p className="mt-6 text-center text-[12px] text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            ← Back to overview
          </Link>
        </p>
      </div>
    </div>
  );
}
