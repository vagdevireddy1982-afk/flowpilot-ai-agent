import { prisma } from "@/lib/db/prisma";
import { getAIProvider } from "@/lib/ai/providers";
import { env, resolveAiProvider, resolveEmailProvider } from "@/lib/env";
import { hasPgVector } from "@/lib/ai/rag/vector-store";

export const SETTINGS_ID = "org";

export async function getSettings() {
  const existing = await prisma.organizationSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;
  return prisma.organizationSettings.create({ data: { id: SETTINGS_ID } });
}

export interface SettingsUpdate {
  name?: string;
  supportEmail?: string;
  defaultCurrency?: string;
  autoApproveMediumRisk?: boolean;
  maxContextMessages?: number;
  notifyOnApproval?: boolean;
  notifyOnEscalation?: boolean;
}

export async function updateSettings(update: SettingsUpdate) {
  await getSettings();
  return prisma.organizationSettings.update({ where: { id: SETTINGS_ID }, data: update });
}

/**
 * Read-only view of the runtime AI configuration for the settings page.
 * Secrets are never returned — only whether one is configured.
 */
export async function getRuntimeConfig() {
  const provider = getAIProvider();
  return {
    configuredProvider: env.AI_PROVIDER,
    activeProvider: resolveAiProvider(),
    apiKeyConfigured: Boolean(env.LLM_API_KEY),
    model: provider.model,
    embeddingModel: provider.embeddingModel,
    baseUrl: env.AI_PROVIDER === "openai" ? env.LLM_BASE_URL : null,
    supportsStreaming: provider.supportsStreaming,
    emailProvider: resolveEmailProvider(),
    emailFrom: env.EMAIL_FROM,
    vectorStoreMode: env.VECTOR_STORE,
    pgvectorAvailable: await hasPgVector(),
    demoMode: env.DEMO_MODE,
  };
}
