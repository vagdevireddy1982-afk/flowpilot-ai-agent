import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { Role } from "@/generated/prisma/enums";
import { auth } from "@/lib/auth";
import { assertPermission, hasPermission, type Permission } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export interface AuthedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface TrpcContext {
  user: AuthedUser | null;
  db: typeof prisma;
  requestId: string;
}

export async function createTRPCContext(): Promise<TrpcContext> {
  const session = await auth();
  const user = session?.user
    ? {
        id: session.user.id,
        name: session.user.name ?? "Unknown",
        email: session.user.email ?? "",
        role: session.user.role,
      }
    : null;

  return { user, db: prisma, requestId: crypto.randomUUID() };
}

const CODE_MAP: Record<AppError["code"], TRPCError["code"]> = {
  NOT_FOUND: "NOT_FOUND",
  VALIDATION: "BAD_REQUEST",
  FORBIDDEN: "FORBIDDEN",
  UNAUTHORIZED: "UNAUTHORIZED",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "TOO_MANY_REQUESTS",
  PROVIDER_ERROR: "INTERNAL_SERVER_ERROR",
  TIMEOUT: "TIMEOUT",
  INTERNAL: "INTERNAL_SERVER_ERROR",
};

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    return {
      ...shape,
      data: {
        ...shape.data,
        // Only ever surface curated messages; stack traces stay server-side.
        zodError: cause instanceof ZodError ? cause.flatten().fieldErrors : null,
        appErrorCode: cause instanceof AppError ? cause.code : null,
      },
    };
  },
});

/**
 * Translates domain errors into transport errors and keeps internal details
 * out of client responses.
 */
const errorBoundary = t.middleware(async ({ next, path, ctx }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof AppError) {
      throw new TRPCError({ code: CODE_MAP[error.code], message: error.userMessage, cause: error });
    }
    if (error instanceof TRPCError) throw error;

    logger.error("trpc.unhandled", {
      path,
      requestId: ctx.requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.split("\n").slice(0, 4).join(" | ") : undefined,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong on our side. Please try again.",
    });
  }
});

const timing = t.middleware(async ({ next, path, type }) => {
  const start = Date.now();
  const result = await next();
  const durationMs = Date.now() - start;
  if (durationMs > 1500) logger.warn("trpc.slow", { path, type, durationMs });
  return result;
});

export const createCallerFactory = t.createCallerFactory;
export const router = t.router;

export const publicProcedure = t.procedure.use(errorBoundary).use(timing);

export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "You need to sign in to continue." });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Declarative permission gate used by every non-trivial procedure. */
export function permissionProcedure(permission: Permission) {
  return protectedProcedure.use(({ ctx, next }) => {
    assertPermission(ctx.user.role, permission);
    return next({ ctx });
  });
}

export { hasPermission };
