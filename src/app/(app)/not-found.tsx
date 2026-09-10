import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="panel max-w-md p-6 text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted">
          <FileQuestion className="size-5 text-muted-foreground" />
        </span>
        <h1 className="mt-3 text-base font-semibold">Record not found</h1>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          It may have been deleted, or the link may be wrong.
        </p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
