import { z } from "zod";

/**
 * Server-side environment contract. Parsed once at module load so a
 * misconfigured deployment fails fast instead of at the first request.
 * Nothing in here is ever imported from a client component.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  AI_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  LLM_MODEL: z.string().default("gpt-4o-mini"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  VECTOR_STORE: z.enum(["auto", "pgvector", "fallback"]).default("auto"),
  EMAIL_PROVIDER: z.enum(["mock", "resend"]).default("mock"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("ops@flowpilot.demo"),
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

function loadEnv(): ServerEnv {
  const parsed = serverSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    // A throwaway default keeps `next build` working in CI images that do not
    // inject secrets; a real deployment must set AUTH_SECRET explicitly.
    AUTH_SECRET: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    AI_PROVIDER: process.env.AI_PROVIDER,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_MODEL: process.env.LLM_MODEL,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    VECTOR_STORE: process.env.VECTOR_STORE,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    DEMO_MODE: process.env.DEMO_MODE,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

/**
 * The provider abstraction accepts `openai` only when a key is actually
 * present; otherwise the app silently degrades to the deterministic mock so a
 * fresh clone runs with zero credentials.
 */
export function resolveAiProvider(): "mock" | "openai" {
  if (env.AI_PROVIDER === "openai" && env.LLM_API_KEY) return "openai";
  return "mock";
}

export function resolveEmailProvider(): "mock" | "resend" {
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) return "resend";
  return "mock";
}
