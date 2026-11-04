import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConnectionPractice, GuidedFullPractice, QuizCloze, KeywordAnswerLabel, KeywordReviewMaterials, evaluateQuizAnswers, quizInlineCorrections, quizAnswerOrder, areQuizCorrectionsComplete } from "../../app/study-app";
import { cellParts, createTable, editCell, encodeTable, tableParts, tableText, type TableTabOrder } from "../../lib/table-card";
import { ShortcutHelp } from "../../components/shortcut-help";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import "../../app/globals.css";

// Browser-only fixture: no application root, API, storage or real learning data.
const kind = new URLSearchParams(location.search).get("kind") || "normal";
const navigationTable = kind === "table-navigation";
const isTable = kind === "table" || navigationTable || kind.endsWith("-table");
const guidedKeyword = kind.startsWith("guided-keyword-");
const guidedFull = kind.startsWith("guided-full-");
const linkedAnswer = kind.includes("linked");
const linkedFormat = "- [b]통합적[/b] 동기 : 목표 문화에 통합되고자 하는 동기\n- [b]도구적[/b] 동기 : 도구를 활용";
let table = createTable(navigationTable ? 3 : 1, 2);
const formats = linkedAnswer ? linkedFormat.split("\n") : navigationTable
  ? ["[b]하나[/b], [b]둘[/b]", "[b]다섯[/b]", "[b]셋[/b]", "[b]여섯[/b]", "[b]넷[/b]", "[b]일곱[/b]"]
  : ["[b]기본 체력운동[/b]", "[b]현대 표현 활동[/b]"];
formats.forEach((format,index) => { table = editCell(table,table.cells[index].id,format); });
const words = linkedAnswer ? ["통합적", "도구적"] : navigationTable ? ["하나", "둘", "다섯", "셋", "여섯", "넷", "일곱"]
  : kind.endsWith("wrong-initial") ? ["매달리기", "버티기나 굽히기"]
  : kind === "guided-keyword-ime" || kind === "hint-ime" ? ["방향 전환 달리기", "버티기나 굽히기"]
  : ["기본 체력운동", "현대 표현 활동"];
const card = {
  id: -999, question: "기본 체력운동 / 현대 표현 활동", questionFormat: "[b]기본 체력운동[/b] / [b]현대 표현 활동[/b]",
  answer: isTable ? tableText(table) : linkedAnswer ? linkedFormat.replace(/\[\/?b\]/g, "") : guidedFull ? "첫 줄\n둘째 줄" : words.join(", "),
  answerFormat: isTable ? encodeTable(table) : linkedAnswer ? linkedFormat : "[b]기본 체력운동[/b], [b]현대 표현 활동[/b]",
  keywords: words, memo: "", media: { question: [], answer: [], memo: [] },
  subject: "체육", contentType: "교육과정" as const, section: "검증용", subsection: "", detailSection: "", area: "", importance: 0,
  sortOrder: 0, correctCount: 0, incorrectCount: 0, correctStreak: 0, masteryStreak: 0,
  lastReviewedAt: null, archivedAt: null, archiveReviewStage: 0, archiveReviewDueAt: null, createdAt: "", updatedAt: "",
};
const parts = isTable ? tableParts(table) : linkedAnswer ? cellParts(linkedFormat) : words.flatMap((keyword, index) => [
  ...(index ? [{ type: "text" as const, value: ", " }] : []), { type: "blank" as const, keyword },
]);

function Fixture() {
  const [tableTabOrder, setTableTabOrder] = useState<TableTabOrder>("vertical");
  const [fullComplete, setFullComplete] = useState(false);
  const [answers, setAnswers] = useState<string[]>([]);
  const [correctionAnswers, setCorrectionAnswers] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const [submissions, setSubmissions] = useState(0);
  const [continued, setContinued] = useState(0);
  const order = quizAnswerOrder(parts);
  const evaluations = evaluateQuizAnswers(words, answers, order);
  const correction = quizInlineCorrections(parts, evaluations, answers);
  const missed = correction.parts.flatMap(part => part.type === "blank" ? [part.keyword] : []);
  const correcting = checked && missed.length > 0;
  const complete = areQuizCorrectionsComplete(missed, correctionAnswers, false);
  const change = (index: number, value: string) => setAnswers(previous => Object.assign([...previous], { [index]: value }));
  const grade = (submitted = answers) => {
    if (checked) return;
    setAnswers(submitted);
    setCorrectionAnswers(quizInlineCorrections(parts, evaluateQuizAnswers(words, submitted, order), submitted).answers);
    setSubmissions(n => n + 1);
    setChecked(true);
  };
  return <main style={{ padding: 20, width: "100%", boxSizing: "border-box" }}>
    <output data-testid="submissions">{submissions}</output><output data-testid="continued">{continued}</output>
    {navigationTable && <ShortcutHelp screen="study-table" tableTabOrder={tableTabOrder} onTableTabOrderChange={setTableTabOrder} />}
    {guidedFull ? <section style={{height:500}}><GuidedFullPractice card={card} completed={fullComplete} onComplete={() => setFullComplete(true)} tableTabOrder={tableTabOrder} /><button onClick={() => setContinued(n=>n+1)} disabled={!fullComplete}>다음으로</button></section>
    : kind === "connection" ? <ConnectionPractice card={card} answers={answers} checked={checked} reverse={false} onChange={change} onSubmit={grade} onContinue={() => setContinued(n => n + 1)} /> : <section className={`study-keyword-mode${isTable ? " is-table-session" : ""}${checked ? " is-answered" : ""}`} style={{ height: 500 }}>
      <div className="quiz-answer-heading"><KeywordAnswerLabel result={checked ? evaluations.every(e => e.matched) ? "correct" : "incorrect" : null} /></div>
      <QuizCloze card={card} partsOverride={correcting ? correction.parts : parts} answers={correcting ? correctionAnswers : answers}
        checked={checked && !correcting} correctionMode={correcting} guidedPractice={guidedKeyword} autoFocusFirst tableTabOrder={tableTabOrder}
        hints={kind.startsWith("hint-") ? { 0: { stage: 2, keyword: words[0], text: "", revision: 0 } } : undefined}
        orderIndependentOverride={false} mobileSubmitOnLast={isTable}
        onChange={correcting ? (index, value) => setCorrectionAnswers(previous => Object.assign([...previous], { [index]: value })) : change}
        onSubmit={checked ? () => undefined : grade} />
      {checked && <KeywordReviewMaterials card={card} />}
      {!checked ? guidedKeyword ? null : <button onClick={() => grade()}>채점하기</button> : <button disabled={!complete} onClick={() => setContinued(n => n + 1)}>다음으로</button>}
    </section>}
  </main>;
}
createRoot(document.getElementById("root")!).render(kind === "help" ? <ShortcutHelp screen="study-table" />
  : kind === "help-layer" ? <><Dialog open><DialogContent className="card-editor-dialog"><DialogHeader><DialogTitle>카드 편집</DialogTitle><DialogDescription>테스트용 창</DialogDescription></DialogHeader><input aria-label="질문" /></DialogContent></Dialog><ShortcutHelp screen="home" /></>
  : <Fixture />);
