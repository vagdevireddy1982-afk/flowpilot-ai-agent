import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { assertPermission } from "@/lib/auth/rbac";
import { MAX_UPLOAD_BYTES } from "@/lib/ai/rag/ingest";
import { type AppErrorCode, isAppError, toUserMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { uploadRateLimiter } from "@/lib/rate-limit";
import { recordAudit } from "@/server/services/audit-service";
import { uploadDocument } from "@/server/services/knowledge-service";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * File upload lives on a route handler rather than tRPC: multipart bodies do
 * not belong in a JSON-RPC payload. Authorization and validation are identical
 * to the rest of the API.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "You need to sign in to continue." }, { status: 401 });
  }

  try {
    assertPermission(session.user.role, "knowledge:write");
    await uploadRateLimiter.check(`upload:${session.user.id}`);

    const formData = await request.formData();
    const file = formData.get("file");
    const title = formData.get("title");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `Files must be smaller than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` },
        { status: 413 },
      );
    }

    const document = await uploadDocument({
      filename: file.name,
      mimeType: file.type,
      title: typeof title === "string" ? title : undefined,
      buffer: Buffer.from(await file.arrayBuffer()),
      uploadedById: session.user.id,
    });

    await recordAudit({
      action: "knowledge.uploaded",
      actorType: "USER",
      userId: session.user.id,
      entityType: "KnowledgeDocument",
      entityId: document.id,
      input: { filename: file.name, sizeBytes: file.size },
      output: { chunkCount: document.chunkCount, status: document.status },
      riskLevel: "MEDIUM",
    });

    return NextResponse.json({
      id: document.id,
      title: document.title,
      chunkCount: document.chunkCount,
      status: document.status,
    });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("knowledge.upload_failed", {
        userId: session.user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const statusByCode: Partial<Record<AppErrorCode, number>> = {
      FORBIDDEN: 403,
      UNAUTHORIZED: 401,
      VALIDATION: 400,
      NOT_FOUND: 404,
      RATE_LIMITED: 429,
      TIMEOUT: 504,
    };
    const status = isAppError(error) ? (statusByCode[error.code] ?? 500) : 500;
    return NextResponse.json({ error: toUserMessage(error) }, { status });
  }
}
