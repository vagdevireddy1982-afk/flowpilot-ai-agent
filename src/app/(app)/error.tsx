"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only safe way to correlate this with the server log.
    console.error("Route error", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="panel max-w-md p-6 text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="size-5 text-destructive" />
        </span>
        <h1 className="mt-3 text-base font-semibold">This page could not be loaded</h1>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          Something went wrong on our side. The error has been logged; you can retry, and if it
          persists the reference below helps us trace it.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">ref {error.digest}</p>
        ) : null}
        <Button className="mt-4" onClick={reset}>
          <RotateCw /> Try again
        </Button>
      </div>
    </div>
  );
}
