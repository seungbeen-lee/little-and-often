import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TableRegistration } from "../../components/table-card";
import { FormattedTextEditor } from "../../app/study-app";
import { extractBoldKeywords, normalizeAnswerFormat } from "../../lib/card-data";
import { createTable, encodeTable, tableKeywords } from "../../lib/table-card";
import "../../app/globals.css";

// Isolated editor only: no API, storage, cards or learning records.
const numbered = new URLSearchParams(location.search).get("list") === "numbered";
const science = new URLSearchParams(location.search).get("list") === "science";
const words = numbered ? ["자유 탐색", "탐색 결과 발표", "교사의 안내에 따른 탐색", "탐색 결과 정리"] : ["문제 인식 및 가설 설정", "탐구 설계 및 수행", "자료  수집·분석 및 해석", "결론 도출 및 일반화", "의사소통과 협업"];
const doc = createTable(1, 1);
doc.cells[0].format = words.map((word,index) => `${numbered?`${index+1}.`:"-"} ${word}`).join("\n");
if(science) doc.cells[0].format="- 과학 가치 : 과학의 심미적 가치, 감수성\n- 과학 태도 : 과학 창의성, 유용성, 윤리성, 개방성\n- 참여와 실천 : 과학문화 향유, 안전·지속가능 사회에 기여";
if(new URLSearchParams(location.search).get("list")==="brackets") doc.cells[0].format="반사적 듣기 (reactive listening)";
function Fixture() {
  const [format, setFormat] = useState(encodeTable(doc));
  const [normal, setNormal] = useState({text:doc.cells[0].format,format:doc.cells[0].format});
  if(new URLSearchParams(location.search).get("kind")==="normal") return <main>
    <FormattedTextEditor {...normal} answer={new URLSearchParams(location.search).get("field")!=="question"} label="답" placeholder="답" onChange={(text,format)=>setNormal({text,format})}/>
    <output data-testid="keywords">{JSON.stringify(extractBoldKeywords(normal.format))}</output>
  </main>;
  return <main><TableRegistration format={format} onChange={(_text, next)=>setFormat(next)}/>
    <output data-testid="keywords">{JSON.stringify(tableKeywords(format).map(item=>item.keyword))}</output>
    <output data-testid="format">{format}</output></main>;
}

// Simulated save acknowledgements only: deliberately allow stale responses to test
// the editor independently of production data, network, and learning records.
function AutosaveFixture() {
  const answer = new URLSearchParams(location.search).get("field") !== "question";
  const initial = { text: doc.cells[0].format, format: doc.cells[0].format };
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState<(typeof initial) & { sourceFormat: string }>();
  const [requested, setRequested] = useState(initial);
  const [previous, setPrevious] = useState(initial);
  const [historyRevision, setHistoryRevision] = useState(0);
  const manual = new URLSearchParams(location.search).get("save") === "manual";
  useEffect(() => {
    if (manual) return;
    const timer = setTimeout(() => setSaved({ ...value, sourceFormat: value.format }), 300);
    return () => clearTimeout(timer);
  }, [value, manual]);
  return <main style={{ paddingTop: 600, paddingBottom: 800 }}>
    <div data-testid="editor-scroller" style={{ height: 280, overflow: "auto" }}>
      <div style={{ height: 180 }} />
      <FormattedTextEditor {...value} answer={answer} autoSave label="답" placeholder="답" savedContent={saved} historyRevision={historyRevision}
        onTabAtEnd={() => document.querySelector<HTMLTextAreaElement>('[data-testid="next-memo"]')?.focus({ preventScroll: true })}
        onChange={(text, format) => { setPrevious(value); setValue({ text, format }); }} />
      <textarea data-testid="next-memo" aria-label="다음 메모" />
      <div style={{ height: 400 }} />
    </div>
    <button onPointerDown={event => { event.preventDefault(); setRequested(value); }}>저장 요청</button>
    <button onPointerDown={event => {
      event.preventDefault();
      const response = { text: requested.text, format: normalizeAnswerFormat(requested.format, requested.text), sourceFormat: requested.format };
      setSaved(response);
      if (value.text === requested.text && value.format === requested.format) setValue({ text: response.text, format: response.format });
    }}>저장 응답</button>
    <button onPointerDown={event => { event.preventDefault(); setValue(previous); setHistoryRevision(revision => revision + 1); }}>되돌리기</button>
    <output data-testid="current-format">{value.format}</output>
    <output data-testid="saved-format">{saved?.format}</output>
    <output data-testid="keywords">{JSON.stringify(extractBoldKeywords(value.format))}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(new URLSearchParams(location.search).get("kind") === "autosave" ? <AutosaveFixture/> : <Fixture/>);
