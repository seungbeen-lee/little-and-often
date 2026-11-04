import { getRawDb } from "../../../../db";
import { unauthorized } from "../../../../lib/auth";
import { toApiError } from "../../../../lib/api-errors";
import { DEFAULT_EXAM_DATE, isValidDayDate } from "../../../../lib/exam-dday";

export async function GET(request: Request) {
  const ownerId = request.headers.get("oai-authenticated-user-id")?.trim();
  if (!ownerId) return unauthorized();
  try {
    const { results } = await getRawDb().prepare("SELECT target_date FROM day_settings WHERE owner_id = ? LIMIT 1").bind(ownerId).all();
    const saved = results[0]?.target_date;
    return Response.json({ targetDate: isValidDayDate(saved) ? saved : DEFAULT_EXAM_DATE }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ownerId = request.headers.get("oai-authenticated-user-id")?.trim();
  if (!ownerId) return unauthorized();
  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json({ error: "날짜를 확인해주세요." }, { status: 400 }); }
  const targetDate = payload && typeof payload === "object" && "targetDate" in payload ? payload.targetDate : null;
  if (!isValidDayDate(targetDate)) return Response.json({ error: "올바른 날짜를 선택해주세요." }, { status: 400 });
  try {
    await getRawDb().prepare("INSERT INTO day_settings (owner_id, target_date) VALUES (?, ?) ON CONFLICT(owner_id) DO UPDATE SET target_date = excluded.target_date").bind(ownerId, targetDate).run();
    return Response.json({ targetDate });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}
