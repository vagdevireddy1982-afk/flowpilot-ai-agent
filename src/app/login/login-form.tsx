"use client";

import { Loader2 } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEMO_ACCOUNTS = [
  { label: "Admin", email: "admin@flowpilot.demo", hint: "Full access, can approve" },
  { label: "Operator", email: "ops@flowpilot.demo", hint: "Uses the agent" },
  { label: "Viewer", email: "viewer@flowpilot.demo", hint: "Read-only" },
];

const DEMO_PASSWORD = "FlowPilot!2024";

export function LoginForm({ demoMode }: { demoMode: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState(demoMode ? DEMO_ACCOUNTS[0]!.email : "");
  const [password, setPassword] = useState(demoMode ? DEMO_PASSWORD : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const result = await signIn("credentials", { email, password, redirect: false });

    if (!result || result.error) {
      setError("That email and password combination is not recognised.");
      setPending(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <>
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
          >
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {demoMode ? (
        <div className="mt-6 border-t pt-4">
          <p className="text-[12px] font-medium text-muted-foreground">Demo accounts</p>
          <div className="mt-2 grid gap-1.5">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(DEMO_PASSWORD);
                }}
                className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-muted"
              >
                <span>
                  <span className="font-medium">{account.label}</span>
                  <span className="ml-2 text-muted-foreground">{account.email}</span>
                </span>
                <span className="hidden text-muted-foreground sm:inline">{account.hint}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            All demo accounts use the password{" "}
            <code className="font-mono text-foreground">{DEMO_PASSWORD}</code>.
          </p>
        </div>
      ) : null}
    </>
  );
}
