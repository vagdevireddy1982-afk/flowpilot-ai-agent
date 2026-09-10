import { z } from "zod";
import { permissionProcedure, router } from "@/server/api/trpc";
import {
  getActionsOverTime,
  getAgentPerformance,
  getDashboardSummary,
  getHumanVsAiResolution,
  getLatencyTrend,
  getTicketCategories,
  getToolUsage,
} from "@/server/services/analytics-service";

export const analyticsRouter = router({
  dashboard: permissionProcedure("analytics:read").query(async () => {
    const [summary, actions, humanVsAi, categories] = await Promise.all([
      getDashboardSummary(),
      getActionsOverTime(14),
      getHumanVsAiResolution(),
      getTicketCategories(),
    ]);
    return { summary, actions, humanVsAi, categories };
  }),

  overview: permissionProcedure("analytics:read")
    .input(z.object({ days: z.number().int().min(7).max(90).default(30) }))
    .query(async ({ input }) => {
      const [performance, actions, toolUsage, latency, categories, humanVsAi] = await Promise.all([
        getAgentPerformance(input.days),
        getActionsOverTime(Math.min(input.days, 30)),
        getToolUsage(),
        getLatencyTrend(Math.min(input.days, 30)),
        getTicketCategories(),
        getHumanVsAiResolution(),
      ]);
      return { performance, actions, toolUsage, latency, categories, humanVsAi };
    }),
});
