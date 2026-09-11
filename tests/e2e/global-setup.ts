import { execFileSync } from "node:child_process";

/**
 * Reseeds the database before the end-to-end suite so every run starts from
 * the same known records (the demo users, ORD-1004, the policy documents).
 * The suite performs real mutations — approving a refund actually refunds an
 * order — so a deterministic starting point is what keeps it re-runnable.
 */
export default function globalSetup() {
  execFileSync("npx", ["tsx", "prisma/seed.ts"], {
    stdio: "inherit",
    env: process.env,
  });
}
