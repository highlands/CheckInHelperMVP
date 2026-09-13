import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { runSynchronization } from "@/lib/sync/service";
import { checkRateLimit, verifyCronSecret } from "@/lib/security";
import {
  buildRateLimitPayload,
  rateLimitResponseHeaders,
} from "@/lib/rate-limit";
import { AuditEventType, createId, dbError, getDb, SyncTriggerType } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin();
    const env = getEnv();

    const rate = checkRateLimit(`sync:${session.user.id}`, env.SYNC_RATE_LIMIT);
    if (!rate.allowed) {
      const payload = buildRateLimitPayload("sync", rate.retryAfterMs);
      return NextResponse.json(payload, {
        status: 429,
        headers: rateLimitResponseHeaders(payload.retryAfterSeconds),
      });
    }

    const body = (await request.json().catch(() => ({}))) as {
      sourceId?: string;
      dryRun?: boolean;
      retryFailedOnly?: boolean;
    };

    const { error } = await getDb().from("AuditEvent").insert({
      id: createId(),
      type: AuditEventType.SYNC_TRIGGERED,
      userId: session.user.id,
      metadata: body,
    });
    if (error) dbError(error, "Unable to record audit event");

    const result = await runSynchronization({
      triggerType: body.sourceId
        ? SyncTriggerType.SINGLE_SOURCE
        : SyncTriggerType.MANUAL,
      triggeredById: session.user.id,
      sourceId: body.sourceId,
      dryRun: body.dryRun,
      retryFailedOnly: body.retryFailedOnly,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Sync failed to start." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const env = getEnv();
  const authHeader = request.headers.get("authorization");

  if (!verifyCronSecret(authHeader, env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runSynchronization({
    triggerType: SyncTriggerType.CRON,
  });

  return NextResponse.json(result);
}
