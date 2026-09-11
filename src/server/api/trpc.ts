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

/** Turns Zod's field errors into one readable sentence for the UI. */
function describeFieldErrors(fieldErrors: Record<string, string[] | undefined>): string {
  const parts = Object.entries(fieldErrors)
    .map(([field, messages]) => (messages?.[0] ? `${field}: ${messages[0].toLowerCase()}` : null))
    .filter((part): part is string => part !== null);
  return parts.length > 0
    ? `Please check the form — ${parts.join("; ")}.`
    : "Some of those details are not valid.";
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    const fieldErrors = cause instanceof ZodError ? cause.flatten().fieldErrors : null;
    return {
      ...shape,
      // Zod's own message is a JSON dump of every issue. Clients get the
      // structured field errors; the message reads as a sentence.
      message: fieldErrors ? describeFieldErrors(fieldErrors) : shape.message,
      // Listed rather than spread: tRPC puts a stack on this outside
      // production, and only curated fields may leave the server.
      data: {
        code: shape.data.code,
        httpStatus: shape.data.httpStatus,
        path: shape.data.path,
        zodError: fieldErrors,
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
  // A failing middleware or resolver comes back as a result rather than an
  // exception, so this cannot be a try/catch: tRPC has already wrapped the
  // original error as `cause` on a TRPCError of its own.
  const result = await next();
  if (result.ok) return result;

  const cause = result.error.cause;
  if (cause instanceof AppError) {
    throw new TRPCError({ code: CODE_MAP[cause.code], message: cause.userMessage, cause });
  }

  // Anything tRPC raised deliberately (an unauthorized guard, a bad request,
  // an unknown procedure) already carries the right code and a safe message.
  if (result.error.code !== "INTERNAL_SERVER_ERROR") return result;

  const error = cause ?? result.error;
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
