import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BulkCreateDialog, CardDialog, FormattedTextEditor } from "../../app/study-app";
import { TableAnswer, TableRegistration } from "../../components/table-card";
import { createTable, editCell, encodeTable, readTable, tableColumnWidths, tableKeywords, tableText } from "../../lib/table-card";
import { emptyMedia } from "../../lib/card-media";
import { PhotoViewerProvider } from "../../components/card-images";
import "../../app/globals.css";

const samples: React.ComponentProps<typeof BulkCreateDialog>["cards"] = Array.from({length:5}, (_,i) => ({id:i+1,subject:"선택 검증",contentType:"교육과정",
  section:"기본",subsection:"",detailSection:"",area:"",importance:1,question:`질문 ${i+1}`,questionFormat:`질문 ${i+1}`,
  answer:`정답 ${i+1}`,answerFormat:`[b]정답 ${i+1}[/b]`,memo:`메모 ${i+1}`,media:emptyMedia(),keywords:[`정답 ${i+1}`],sortOrder:i,
  correctCount:0,incorrectCount:0,correctStreak:0,masteryStreak:0,lastReviewedAt:null,archivedAt:null,archiveReviewStage:0,archiveReviewDueAt:null,
  createdAt:"2026-09-27T00:00:00.000Z",updatedAt:"2026-09-27T00:00:00.000Z"}));
let table = createTable(3,3);
table.cells.forEach((cell,i)=>{table=editCell(table,cell.id,i===0?"[b]항목 1[/b]":`항목 ${i+1}`);});
samples[4] = {...samples[4], answer:tableText(table), answerFormat:encodeTable(table), keywords:tableKeywords(encodeTable(table)).map(item=>item.keyword)};
if(new URLSearchParams(location.search).has("delete-single"))samples.splice(1);
let layoutTable=createTable(3,3);
const layoutContent=["영역","활동","예시 활동","[b]자율·자치[/b] 활동","[b]자율[/b] 활동","- [b]주제 탐구 활동[/b] : 개인 연구, 소집단 공동 연구, 프로젝트\n- [b]적응 및 개척 활동[/b] : 입학 초기 적응, 학교 이해, 정체성 지원, 관계 형성\n- [b]프로젝트형 봉사활동[/b] : 개인 프로젝트형 봉사활동, 공동 프로젝트형 봉사활동","[b]동아리[/b] 활동","[b]학술·문화 및 여가[/b] 활동","- [b]기본생활습관 형성 활동[/b] : 자기 관리 활동, 환경·생태의식 함양 활동, 생명존중 의식 함양 활동, 민주시민 의식 함양 활동"];
layoutTable.cells.forEach((cell,index)=>{layoutTable=editCell(layoutTable,cell.id,layoutContent[index]);});
let spacingTable=createTable(3,2);
const spacingContent=["[b]첫 글자[/b]부터 시작","일반 글자부터 시작","  [b]직접 입력한 공백[/b]\n[b]다음 줄[/b]의 내용","[b]자율[/b]활동","- [b]목록[/b] : 설명","[b]첫째[/b], [b]둘째[/b]"];
spacingTable.cells.forEach((cell,index)=>{spacingTable=editCell(spacingTable,cell.id,spacingContent[index]);});
function Fixture() {
  const [cards,setCards] = useState(samples);
  const [cardDialogOpen,setCardDialogOpen] = useState(true);
  const layout=new URLSearchParams(location.search).has("layout");
  const [format,setFormat] = useState(new URLSearchParams(location.search).has("empty")?"":encodeTable(new URLSearchParams(location.search).has("spacing")?spacingTable:layout?layoutTable:table));
  const [savedSet,setSavedSet] = useState<unknown>(null);
  const [applies,setApplies]=useState(0);
  const [failApply,setFailApply]=useState(new URLSearchParams(location.search).has("fail-apply"));
  const [normal,setNormal]=useState({text:"기존 일반 답안",format:"기존 일반 답안"});
  const apply=(_text:string,next:string)=>{
    if(failApply||new URLSearchParams(location.search).has("fail-always")){setFailApply(false);throw new Error("자동 적용 테스트 오류");}
    setFormat(next);setApplies(count=>count+1);
  };
  if(new URLSearchParams(location.search).get("kind")==="table-conversion")return <main>
    <FormattedTextEditor {...normal} answer label="답" placeholder="답" onChange={(text,format)=>{setNormal({text,format});setApplies(count=>count+1);}}/>
    <output data-testid="table-format">{normal.format}</output><output data-testid="table-text">{normal.text}</output><output data-testid="table-applies">{applies}</output>
  </main>;
  if(new URLSearchParams(location.search).get("kind")==="viewer"){
    const tall=new URLSearchParams(location.search).has("tall");
    let viewer=createTable(tall?25:6,2);
    viewer.cells.forEach((cell,index)=>{viewer=editCell(viewer,cell.id,index===0?"단계 명":index===1?"특징":index===11?"학습 자료 추가 제시 → 발견한 개념이나 규칙성을 다른 상황에 적용":`단계 ${index}`);});
    return <main><TableAnswer doc={viewer} buttonOnly /></main>;
  }
  if(new URLSearchParams(location.search).get("kind")==="table")return <main><TableRegistration format={format} onChange={apply}/><output data-testid="words">{JSON.stringify(tableKeywords(format).map(item=>item.keyword))}</output><output data-testid="table-format">{format}</output><output data-testid="table-applies">{applies}</output>{layout&&<output data-testid="layout-natural-widths">{JSON.stringify(tableColumnWidths(layoutTable,true))}</output>}</main>;
  if(new URLSearchParams(location.search).get("kind")==="viewer-ratio")return <main><TableRegistration format={format} onChange={apply}/><TableAnswer doc={readTable(format)!} buttonOnly={new URLSearchParams(location.search).has("button-only")}/><output hidden data-testid="table-format">{format}</output><output hidden data-testid="table-applies">{applies}</output></main>;
  if(new URLSearchParams(location.search).get("kind")==="card")return <main>
    <button onClick={()=>setCardDialogOpen(true)}>카드 편집 열기</button>
    {cardDialogOpen && <CardDialog open={cardDialogOpen} onOpenChange={setCardDialogOpen} initial={cards[0]} subjects={["선택 검증"]} onSaved={card=>setCards(previous=>previous.map(item=>item.id===card.id?card:item))} mobileLayered/>}
    <output data-testid="saved-card-memo">{cards[0].memo}</output>
  </main>;
  return <><BulkCreateDialog open onOpenChange={()=>{}} initialSubject="선택 검증" initialSet={null} initialSelectedCardId={null} startInSetMode={false} subjects={["선택 검증"]} cards={cards} onSaved={setCards} onCardArchived={()=>{}} onSetSaved={setSavedSet} onView={()=>{}}/>
    <output data-testid="saved-cards">{JSON.stringify(cards.map(card=>card.id))}</output><output data-testid="saved-set">{JSON.stringify(savedSet)}</output></>;
}
createRoot(document.getElementById("root")!).render(<PhotoViewerProvider><Fixture/></PhotoViewerProvider>);
