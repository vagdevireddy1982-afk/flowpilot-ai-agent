/**
 * Application error taxonomy.
 *
 * Every layer below tRPC throws these instead of raw `Error`s so the API
 * boundary can map them onto safe, user-facing messages. Raw stack traces and
 * database errors never reach the client.
 */

export type AppErrorCode =
  | "NOT_FOUND"
  | "VALIDATION"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: AppErrorCode;
  /** Safe to render in the UI. */
  readonly userMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    userMessage: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(userMessage, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage;
    this.details = options?.details;
  }
}

export const notFound = (entity: string, id?: string) =>
  new AppError("NOT_FOUND", id ? `${entity} "${id}" was not found.` : `${entity} was not found.`);

export const forbidden = (action = "perform this action") =>
  new AppError("FORBIDDEN", `You do not have permission to ${action}.`);

export const unauthorized = () =>
  new AppError("UNAUTHORIZED", "You need to sign in to continue.");

export const conflict = (message: string) => new AppError("CONFLICT", message);

export const validationError = (message: string, details?: Record<string, unknown>) =>
  new AppError("VALIDATION", message, { details });

export const rateLimited = (retryAfterMs: number) =>
  new AppError("RATE_LIMITED", "Too many requests. Please slow down and retry shortly.", {
    details: { retryAfterMs },
  });

export const providerError = (message: string, cause?: unknown) =>
  new AppError("PROVIDER_ERROR", message, { cause });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Converts anything thrown into a message that is safe to show a user. */
export function toUserMessage(error: unknown): string {
  if (isAppError(error)) return error.userMessage;
  return "Something went wrong on our side. The team has been notified.";
}
