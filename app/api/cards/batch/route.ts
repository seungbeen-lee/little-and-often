import { getDb } from "../../../../db";
import { cards } from "../../../../db/schema";
import { toApiError } from "../../../../lib/api-errors";
import { getOwnerEmail, unauthorized } from "../../../../lib/auth";
import { cardForResponse, extractBoldKeywords, normalizeCardEditorContent, normalizeImportance, serializeKeywords } from "../../../../lib/card-data";
import { normalizeCardContentType } from "../../../../lib/card-content-types";

type BatchPayload = {
  subject?: string;
  cards?: Array<{
    contentType?: string;
    section?: string;
    subsection?: string;
    detailSection?: string;
    question?: string;
    questionFormat?: string;
    answer?: string;
    answerFormat?: string;
    memo?: string;
    importance?: number;
  }>;
};

export async function POST(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();

  try {
    const payload = (await request.json()) as BatchPayload;
    const subject = payload.subject?.trim() ?? "";
    const rows = (payload.cards ?? []).map((card) => {
      const content = normalizeCardEditorContent(card);
      return {
        contentType: normalizeCardContentType(card.contentType),
        section: card.section?.trim() || "기본",
        subsection: card.subsection?.trim() ?? "",
        detailSection: card.detailSection?.trim() ?? "",
        ...content,
        importance: normalizeImportance(card.importance),
        keywords: serializeKeywords(extractBoldKeywords(content.answerFormat)),
      };
    });

    if (!subject) {
      return Response.json({ error: "과목을 선택해 주세요." }, { status: 400 });
    }

    if (rows.length === 0 || rows.length > 100) {
      return Response.json(
        { error: "한 번에 1장부터 100장까지 저장할 수 있어요." },
        { status: 400 }
      );
    }

    if (rows.some((card) => !card.question || !card.answer)) {
      return Response.json(
        { error: "모든 질문에는 답이 함께 있어야 해요." },
        { status: 400 }
      );
    }
    if (rows.some((card) => card.detailSection && !card.subsection)) {
      return Response.json({ error: "세부 섹션을 쓰려면 하위 섹션이 먼저 필요해요." }, { status: 400 });
    }

    const created = await getDb()
      .insert(cards)
      .values(
        rows.map((card) => ({
          ownerEmail,
          subject,
          contentType: card.contentType,
          section: card.section,
          subsection: card.subsection,
          detailSection: card.detailSection,
          area: "",
          importance: card.importance,
          question: card.question,
          questionFormat: card.questionFormat,
          answer: card.answer,
          answerFormat: card.answerFormat,
          memo: card.memo,
          keywords: card.keywords,
        }))
      )
      .returning();

    return Response.json({ cards: created.map(cardForResponse) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}
