import { activityRouter } from "@/server/api/routers/activity";
import { agentRouter } from "@/server/api/routers/agent";
import { analyticsRouter } from "@/server/api/routers/analytics";
import { approvalRouter } from "@/server/api/routers/approval";
import { customerRouter } from "@/server/api/routers/customer";
import { knowledgeRouter } from "@/server/api/routers/knowledge";
import { orderRouter } from "@/server/api/routers/order";
import { settingsRouter } from "@/server/api/routers/settings";
import { ticketRouter } from "@/server/api/routers/ticket";
import { createCallerFactory, createTRPCContext, router } from "@/server/api/trpc";

export const appRouter = router({
  agent: agentRouter,
  approval: approvalRouter,
  customer: customerRouter,
  order: orderRouter,
  ticket: ticketRouter,
  knowledge: knowledgeRouter,
  activity: activityRouter,
  analytics: analyticsRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;

const createCaller = createCallerFactory(appRouter);

/** Server-side caller used by React Server Components and tests. */
export async function createServerCaller() {
  return createCaller(await createTRPCContext());
}
