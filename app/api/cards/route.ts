import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { cards } from "../../../db/schema";
import { toApiError } from "../../../lib/api-errors";
import { getOwnerEmail, unauthorized } from "../../../lib/auth";
import { cardForResponse, extractBoldKeywords, normalizeCardEditorContent, normalizeImportance, serializeKeywords } from "../../../lib/card-data";
import { normalizeCardContentType } from "../../../lib/card-content-types";
import { normalizeMedia } from "../../../lib/card-media";
import { ownsMedia } from "../../../lib/card-image-storage";

type CardPayload = {
  subject?: string;
  contentType?: string;
  section?: string;
  subsection?: string;
  detailSection?: string;
  area?: string;
  importance?: number;
  question?: string;
  questionFormat?: string;
  answer?: string;
  answerFormat?: string;
  memo?: string;
  media?: unknown;
  keywords?: unknown;
  keywordsFromBold?: boolean;
};

export async function GET(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();

  try {
    const rows = await getDb()
      .select()
      .from(cards)
      .where(eq(cards.ownerEmail, ownerEmail))
      .orderBy(asc(cards.subject), asc(cards.sortOrder), asc(cards.id));

    return Response.json({ cards: rows.map(cardForResponse) });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();

  try {
    const payload = (await request.json()) as CardPayload;
    const subject = payload.subject?.trim() ?? "";
    const contentType = normalizeCardContentType(payload.contentType);
    const section = payload.section?.trim() ?? "";
    const subsection = payload.subsection?.trim() ?? "";
    const detailSection = payload.detailSection?.trim() ?? "";
    const area = payload.area?.trim() ?? "";
    const { question, questionFormat, answer, answerFormat, memo } = normalizeCardEditorContent(payload);
    const keywords = serializeKeywords(payload.keywordsFromBold ? extractBoldKeywords(answerFormat) : payload.keywords);
    const importance = normalizeImportance(payload.importance);
    const media = normalizeMedia(payload.media);
    if (!await ownsMedia(ownerEmail, media)) return Response.json({ error: "첨부 사진을 확인할 수 없어요. 다시 첨부해 주세요." }, { status: 400 });

    if (!subject || !section || !question || !answer) {
      return Response.json(
        { error: "과목, 섹션, 질문, 답을 모두 입력해 주세요." },
        { status: 400 }
      );
    }
    if (detailSection && !subsection) {
      return Response.json({ error: "세부 섹션을 쓰려면 하위 섹션이 먼저 필요해요." }, { status: 400 });
    }

    const [card] = await getDb()
      .insert(cards)
      .values({
        ownerEmail,
        subject,
        contentType,
        section,
        subsection,
        detailSection,
        area,
        importance,
        question,
        questionFormat,
        answer,
        answerFormat,
        memo,
        media: JSON.stringify(media),
        keywords,
      })
      .returning();

    return Response.json({ card: cardForResponse(card) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}
