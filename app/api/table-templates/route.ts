import { getRawDb } from "../../../db";
import { unauthorized } from "../../../lib/auth";
import { toApiError } from "../../../lib/api-errors";
import { validateTemplateInput } from "../../../lib/table-template";

const fields = "id, name, format, created_at AS createdAt";
const responseHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const ownerId = request.headers.get("oai-authenticated-user-id")?.trim();
  if (!ownerId) return unauthorized();
  try {
    const { results } = await getRawDb().prepare(`SELECT ${fields} FROM table_templates WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC`).bind(ownerId).all();
    return Response.json({ templates: results }, { headers: responseHeaders });
  } catch (error) { return Response.json({ error: toApiError(error) }, { status: 500 }); }
}

export async function POST(request: Request) {
  const ownerId = request.headers.get("oai-authenticated-user-id")?.trim();
  if (!ownerId) return unauthorized();
  let input;
  try {
    const raw = await request.text();
    if (raw.length > 600000) throw new Error("표 크기를 줄여 주세요.");
    input = validateTemplateInput(JSON.parse(raw));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "템플릿 정보를 확인해 주세요." }, { status: 400 }); }
  try {
    const db = getRawDb();
    // A retry after an interrupted response does not create a second template.
    await db.prepare("INSERT INTO table_templates (id, owner_id, name, format) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").bind(input.id, ownerId, input.name, input.format).run();
    const { results } = await db.prepare(`SELECT ${fields} FROM table_templates WHERE id = ? AND owner_id = ?`).bind(input.id, ownerId).all();
    const template = results[0];
    if (!template || template.name !== input.name || template.format !== input.format) return Response.json({ error: "저장 정보가 변경되었어요. 템플릿 창을 다시 열어 주세요." }, { status: 409 });
    return Response.json({ template }, { status: 201, headers: responseHeaders });
  } catch (error) { return Response.json({ error: toApiError(error) }, { status: 500 }); }
}
