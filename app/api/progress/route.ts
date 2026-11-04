import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { studyProgress } from "../../../db/schema";
import { toApiError } from "../../../lib/api-errors";
import { getOwnerEmail, unauthorized } from "../../../lib/auth";

type ProgressPayload = {
  contextKey?: string;
  progress?: {
    nextCardId?: number;
    sequenceIds?: number[];
    sessionMode?: "real" | "practice" | null;
    updatedAt?: string;
  } | null;
};

function validContextKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1000;
}

function validSequenceIds(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length <= 100
    && value.every((id) => Number.isInteger(id) && id > 0);
}

export async function GET(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();

  try {
    const contextKey = new URL(request.url).searchParams.get("contextKey") ?? "";
    if (!validContextKey(contextKey)) {
      return Response.json({ error: "학습 범위가 올바르지 않습니다." }, { status: 400 });
    }
    const [saved] = await getDb()
      .select({ nextCardId: studyProgress.nextCardId, sequenceIds: studyProgress.sequenceIds, sessionMode: studyProgress.sessionMode, updatedAt: studyProgress.updatedAt })
      .from(studyProgress)
      .where(and(eq(studyProgress.ownerEmail, ownerEmail), eq(studyProgress.contextKey, contextKey)))
      .limit(1);
    if (!saved) return Response.json({ progress: null });

    let sequenceIds: number[] = [];
    try {
      const parsed = JSON.parse(saved.sequenceIds) as unknown;
      if (validSequenceIds(parsed)) sequenceIds = parsed;
    } catch {
      sequenceIds = [];
    }
    return Response.json({ progress: { nextCardId: saved.nextCardId, sequenceIds, sessionMode: saved.sessionMode, updatedAt: saved.updatedAt } });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();

  try {
    const payload = (await request.json()) as ProgressPayload;
    const contextKey = payload.contextKey ?? "";
    if (!validContextKey(contextKey)) {
      return Response.json({ error: "학습 범위가 올바르지 않습니다." }, { status: 400 });
    }
    if (payload.progress === null) {
      await getDb()
        .delete(studyProgress)
        .where(and(eq(studyProgress.ownerEmail, ownerEmail), eq(studyProgress.contextKey, contextKey)));
      return Response.json({ saved: true });
    }

    const nextCardId = Number(payload.progress?.nextCardId);
    const sequenceIds = payload.progress?.sequenceIds;
    const updatedAt = payload.progress?.updatedAt;
    const sessionMode = payload.progress?.sessionMode;
    if (sessionMode != null && sessionMode !== "real" && sessionMode !== "practice") {
      return Response.json({ error: "학습 모드가 올바르지 않습니다." }, { status: 400 });
    }
    if (!Number.isInteger(nextCardId) || nextCardId <= 0 || !validSequenceIds(sequenceIds) || !updatedAt || Number.isNaN(Date.parse(updatedAt))) {
      return Response.json({ error: "학습 진도가 올바르지 않습니다." }, { status: 400 });
    }
    await getDb()
      .insert(studyProgress)
      .values({ ownerEmail, contextKey, nextCardId, sequenceIds: JSON.stringify(sequenceIds), sessionMode, updatedAt })
      .onConflictDoUpdate({
        target: [studyProgress.ownerEmail, studyProgress.contextKey],
        set: { nextCardId, sequenceIds: JSON.stringify(sequenceIds), ...(sessionMode ? { sessionMode } : {}), updatedAt },
      });
    return Response.json({ saved: true });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}
