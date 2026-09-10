import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";
import { appRouter } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";
import { logger } from "@/lib/logger";

const handler = (request: NextRequest) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: () => createTRPCContext(),
    onError({ path, error }) {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        logger.error("trpc.handler_error", { path, message: error.message });
      }
    },
  });

export { handler as GET, handler as POST };
