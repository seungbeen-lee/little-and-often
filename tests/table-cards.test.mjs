import assert from "node:assert/strict";
import test, {after} from "node:test";
import {readFileSync,readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {createServer} from "vite";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";

const root=fileURLToPath(new URL("..",import.meta.url));
const db=new DatabaseSync(":memory:");
for(const file of readdirSync(new URL("../drizzle",import.meta.url)).filter(x=>x.endsWith(".sql")).sort())db.exec(readFileSync(new URL(`../drizzle/${file}`,import.meta.url),"utf8"));
const binding={prepare(query){return{bind(...values){const stmt=db.prepare(query);return{async all(){return{results:stmt.all(...values),success:true};},async raw(){stmt.setReturnArrays(true);return stmt.all(...values);},async run(){stmt.run(...values);return{success:true};}};}};},async batch(statements){return Promise.all(statements.map(s=>s.all()));}};
globalThis.__tableTestEnv={DB:binding};
const vite=await createServer({root,configFile:false,appType:"custom",server:{middlewareMode:true,hmr:false},resolve:{alias:{"@":root}},plugins:[{name:"table-test-env",resolveId(id){if(id==="cloudflare:workers")return"\0table-test-env";},load(id){if(id==="\0table-test-env")return"export const env=globalThis.__tableTestEnv;";}}]});
after(async()=>{await vite.close();db.close();delete globalThis.__tableTestEnv;});
const t=await vite.ssrLoadModule("/lib/table-card.ts");
const app=await vite.ssrLoadModule("/app/study-app.tsx");
const selections=await vite.ssrLoadModule("/lib/editor-selection.ts");
test("F8 cycles saved alignment and preserves content, IDs, and legacy defaults",()=>{
  const original=t.createTable(1,3);
  original.cells[0].shade=1;
  let doc=t.editCell(original,original.cells[1].id,"[b]정답[/b]");
  const selected=[doc.cells[1].id,doc.cells[2].id];
  const ids=structuredClone(doc.cells[1].keywordIds);
  assert.equal(t.tableCellAlignment(doc.cells[0]),"center");
  assert.equal(t.tableCellAlignment(doc.cells[1]),"left");
  assert.equal(t.cycleTableAlignment(doc,[]),doc);
  for(const alignment of ["center","right","justify","left"]){
    doc=t.readTable(t.encodeTable(t.cycleTableAlignment(doc,selected)));
    assert.equal(doc.cells[1].textAlign,alignment);
    assert.equal(doc.cells[2].textAlign,alignment);
    assert.deepEqual(doc.cells[1].keywordIds,ids);
    assert.equal(doc.cells[1].format,"[b]정답[/b]");
    assert.equal(doc.cells[0].textAlign,undefined);
  }
  assert.equal(t.cycleTableAlignment(doc,[doc.cells[0].id]).cells[0].textAlign,"right");
  assert.throws(()=>t.validateTable({...doc,cells:doc.cells.map(cell=>({...cell,textAlign:"invalid"}))}));
  const event={key:"F8",code:"F8",ctrlKey:false,metaKey:false,altKey:false,shiftKey:false};
  assert.equal(t.tableEditorShortcut(event),"alignment");
  for(const modifier of ["ctrlKey","metaKey","altKey","shiftKey"])assert.equal(t.tableEditorShortcut({...event,[modifier]:true}),null);
});
const headers={"oai-authenticated-user-email":"table-test@example.invalid","Content-Type":"application/json"};
const request=(payload)=>new Request("https://test.invalid/api",{method:"POST",headers,body:JSON.stringify(payload)});
test("table templates persist privately, validate documents, and retry without duplicates",async()=>{
  const api=await vite.ssrLoadModule("/app/api/table-templates/route.ts");
  const req=(owner,body)=>new Request("https://test.invalid/api/table-templates",{headers:owner?{"oai-authenticated-user-id":owner}: {},...(body?{method:"POST",body:JSON.stringify(body)}:{})});
  const input={id:"template-test",name:" 단계와 특징 ",format:t.encodeTable(sample())};
  assert.equal((await api.GET(req(null))).status,401);
  assert.equal((await api.POST(req(null,input))).status,401);
  assert.equal((await api.POST(req("owner-a",{...input,name:" "}))).status,400);
  assert.equal((await api.POST(req("owner-a",{...input,format:"broken"}))).status,400);
  assert.equal((await api.POST(req("owner-a",input))).status,201);
  assert.equal((await api.POST(req("owner-a",input))).status,201);
  assert.equal((await api.POST(req("owner-b",input))).status,409);
  const own=await(await api.GET(req("owner-a"))).json();
  assert.equal(own.templates.length,1);assert.equal(own.templates[0].name,"단계와 특징");
  assert.equal(own.templates[0].format,input.format);
  assert.equal((await(await api.GET(req("owner-b"))).json()).templates.length,0);
});

test("template copies preserve merged geometry and content but generate new learning IDs",async()=>{
  const {instantiateTableTemplate}=await vite.ssrLoadModule("/lib/table-template.ts");
  let source=sample();source=t.mergeCells(source,[source.cells[0].id,source.cells[1].id]);
  source.cells[0].shade=1;
  const format=t.encodeTable(source),a=instantiateTableTemplate(format),b=instantiateTableTemplate(format);
  assert.equal(t.tableText(a),t.tableText(source));
  assert.deepEqual(a.cells.map(c=>[c.format,c.rowSpan,c.colSpan,c.shade]),source.cells.map(c=>[c.format,c.rowSpan,c.colSpan,c.shade]));
  const ids=d=>[...d.rows,...d.columns,...d.cells.flatMap(c=>[c.id,...c.keywordIds])];
  assert.equal(ids(a).some(id=>ids(source).includes(id)||ids(b).includes(id)),false);
  assert.equal(t.encodeTable(source),format,"original is unchanged");
  assert.throws(()=>instantiateTableTemplate("invalid"));
});
function sample(){let doc=t.createTable(2,2);doc=t.editCell(doc,doc.cells[0].id,"영역");doc=t.editCell(doc,doc.cells[1].id,"[b]같은 말[/b]");doc=t.editCell(doc,doc.cells[2].id,"다른 영역");return t.editCell(doc,doc.cells[3].id,"[b]같은 말[/b], [b]나머지[/b]");}

test("table close confirmation only guards content changed since opening or loading a template",async()=>{
  const {tableDraftSignature,hasUnsavedTableContent}=await vite.ssrLoadModule("/lib/table-editor-draft.ts");
  const {instantiateTableTemplate}=await vite.ssrLoadModule("/lib/table-template.ts");
  const source=sample(),baseline=tableDraftSignature(source);
  assert.equal(hasUnsavedTableContent(source,baseline),false);
  assert.equal(hasUnsavedTableContent(instantiateTableTemplate(t.encodeTable(source)),baseline),false,"fresh template IDs are not edits");
  const changed=t.editCell(source,source.cells[0].id,"새 내용");
  assert.equal(hasUnsavedTableContent(changed,baseline),true);
  assert.equal(hasUnsavedTableContent(t.editCell(changed,source.cells[0].id,"영역"),baseline),false,"restored content is unchanged");
  assert.equal(hasUnsavedTableContent(t.editCell(source,source.cells[0].id,""),baseline),true,"partial deletion is an edit");
  assert.equal(hasUnsavedTableContent(t.editCell(source,source.cells[0].id,"[b]영역[/b]"),baseline),true,"keyword edits are protected");
  const blank=t.createTable(4,3);
  assert.equal(hasUnsavedTableContent(blank,baseline),false,"empty table closes directly");
  assert.equal(hasUnsavedTableContent(t.editCell(blank,blank.cells[0].id,"[b] \n [/b]"),baseline),false);
  assert.equal(hasUnsavedTableContent(t.resizeTable(source,"row",source.rows.length),baseline),false,"extra empty rows are not new content");
});

test("selected templates crop the block and append exactly two empty rows",async()=>{
  const {selectedTableTemplate}=await vite.ssrLoadModule("/lib/table-template.ts");
  let source=t.createTable(3,3);
  source=t.editCell(source,source.cells[4].id,"[b]제목[/b]");
  source=t.editCell(source,source.cells[5].id,"설명");
  source=t.editCell(source,source.cells[0].id,"저장되면 안 되는 내용");
  source.cells[4].shade=1;
  const before=t.encodeTable(source),doc=selectedTableTemplate(source,[source.cells[4].id,source.cells[5].id]);
  assert.equal(doc.rows.length,3);assert.equal(doc.columns.length,2);
  assert.equal(t.tableText(doc),"제목\t설명");
  assert.equal(doc.cells.find(c=>c.format.includes("제목")).shade,1);
  assert.equal(doc.cells.filter(c=>doc.rows.indexOf(c.row)>0).every(c=>c.format===""&&c.shade===0&&c.rowSpan===1&&c.keywordIds.length===0),true);
  assert.equal(t.encodeTable(source),before,"saving does not alter current editor content");
  assert.throws(()=>selectedTableTemplate(source,[source.cells[0].id]));
  const full=t.createTable(20,20);assert.throws(()=>selectedTableTemplate(full,full.cells.map(c=>c.id)),/빈 행 2개/);
});

test("selected templates preserve merges and omit unselected content within gaps",async()=>{
  const {selectedTableTemplate}=await vite.ssrLoadModule("/lib/table-template.ts");
  let source=t.createTable(3,3);const ids=source.cells.map(c=>c.id);
  source=t.editCell(source,ids[0],"병합 제목");source=t.editCell(source,ids[1],"포함 안 함");source=t.editCell(source,ids[8],"끝");
  source=t.mergeCells(source,[ids[0],ids[3]]);
  const doc=selectedTableTemplate(source,[ids[0],ids[8]]);
  assert.equal(doc.rows.length,5);assert.equal(doc.columns.length,3);
  assert.equal(doc.cells.find(c=>c.format.includes("병합 제목")).rowSpan,2);
  assert.equal(t.tableText(doc).includes("포함 안 함"),false);
  assert.equal(doc.cells.filter(c=>doc.rows.indexOf(c.row)>=3).length,6);
  assert.doesNotThrow(()=>t.validateTable(doc));
});

test("editor selection preserves anchors, reverse ranges and discontiguous toggles",()=>{
  const ids=["a","b","c","d"];
  assert.deepEqual(selections.selectEditorItems(ids,[],"d","b","range"),["b","c","d"]);
  assert.deepEqual(selections.selectEditorItems(ids,["a","b"],"a","b","toggle"),["a"]);
  assert.deepEqual(selections.selectEditorItems(ids,["a"],"a","d","toggle"),["a","d"]);
  assert.deepEqual(selections.selectEditorItems(ids,["a"],"missing","c","range"),["c"]);
  let doc=t.createTable(3,3);
  const [a,b,c,d,e,f,g,h,i]=doc.cells.map(cell=>cell.id);
  assert.deepEqual(selections.tableSelectionRange(doc,a,e),[a,b,d,e]);
  assert.deepEqual(selections.tableSelectionRange(doc,e,a),[a,b,d,e]);
  doc=t.mergeCells(doc,[b,c,e,f]);
  const range=selections.tableSelectionRange(doc,d,h);
  assert.equal(range.length,6,"intersecting merged cell expands to a complete rectangle");
  assert.ok(range.includes(a)&&range.includes(i)&&range.includes(g));
});

test("empty bulk deletion requires explicit exact IDs and cannot delete unseen remote cards",async()=>{
  const create=await vite.ssrLoadModule("/app/api/cards/route.ts");
  const organize=await vite.ssrLoadModule("/app/api/cards/organize/route.ts");
  const subject="선택 삭제 검증";
  const added=await create.POST(request({subject,section:"기본",question:"테스트 질문",answer:"테스트 답",answerFormat:"[b]테스트 답[/b]",keywordsFromBold:true}));
  assert.equal(added.status,201);const id=(await added.json()).card.id;
  assert.equal((await organize.POST(request({subject,cards:[]}))).status,400);
  assert.equal((await organize.POST(request({subject,cards:[],deleteCardIds:[]}))).status,409);
  assert.equal((await organize.POST(request({subject,cards:[],deleteCardIds:[id,id]}))).status,409);
  assert.equal((await organize.POST(request({subject,cards:[],deleteCardIds:[id+999]}))).status,409);
  const removed=await organize.POST(request({subject,cards:[],deleteCardIds:[id]}));
  assert.equal(removed.status,200);assert.deepEqual((await removed.json()).cards,[]);
});

test("table round-trip, large keyword count, stable IDs and reversible structure",()=>{
  let doc=sample();const before=t.tableKeywords(t.encodeTable(doc));
  assert.equal(before.length,3);assert.notEqual(before[0].keywordKey,before[1].keywordKey);
  doc=t.resizeTable(doc,"row",0);assert.deepEqual(t.tableKeywords(t.encodeTable(doc)).map(x=>x.keywordKey),before.map(x=>x.keywordKey));
  const last=doc.cells.at(-1);const combined=t.mergeCells(doc,doc.cells.filter(x=>x.row===last.row).map(x=>x.id));
  const restored=t.unmergeCells(combined,[combined.cells.at(-1).id]);
  assert.deepEqual(t.tableKeywords(t.encodeTable(restored)).map(x=>x.keywordKey),before.map(x=>x.keywordKey));
  assert.deepEqual(t.readTable(t.encodeTable(restored)),restored);
  let large=t.createTable(1,1);large=t.editCell(large,large.cells[0].id,Array.from({length:40},(_,i)=>`[b]키워드${i}[/b]`).join(", "));
  assert.equal(t.tableKeywords(t.encodeTable(large)).length,40);
  assert.equal(t.splitBoldLists("[b]사과, 배[/b]"),"[b]사과[/b], [b]배[/b]");
});

test("table bold lists exclude leading dashes and keep five separate keywords",()=>{
  const words=["문제 인식 및 가설 설정","탐구 설계 및 수행","자료  수집·분석 및 해석","결론 도출 및 일반화","의사소통과 협업"];
  const text=words.map(word=>`- ${word}`).join("\n");
  for(const format of [`[b]${text}[/b]`,words.map(word=>`[b]- ${word}[/b]`).join("\n")]){
    const original=t.createTable(1,1),id=original.cells[0].id;
    const edited=t.editCell(original,id,format);
    assert.deepEqual(t.tableKeywords(t.encodeTable(edited)).map(item=>item.keyword),words);
    assert.equal(edited.cells[0].format,words.map(word=>`• [b]${word}[/b]`).join("\n"));
    assert.equal(t.plainCell(edited.cells[0].format),words.map(word=>`• ${word}`).join("\n"));
    assert.deepEqual(t.readTable(t.encodeTable(edited)),edited);
    assert.deepEqual(t.editCell(edited,id,edited.cells[0].format),edited);
    assert.equal(original.cells[0].format,"");
  }
});

test("numbered list markers stay visible outside four bold keywords",()=>{
  const words=["자유 탐색","탐색 결과 발표","교사의 안내에 따른 탐색","탐색 결과 정리"];
  const text=words.map((word,index)=>`${index+1}. ${word}`).join("\n");
  const original=t.createTable(1,1),id=original.cells[0].id;
  const edited=t.editCell(original,id,`[b]${text}[/b]`);
  assert.deepEqual(t.tableKeywords(t.encodeTable(edited)).map(item=>item.keyword),words);
  assert.equal(edited.cells[0].format,words.map((word,index)=>`${index+1}. [b]${word}[/b]`).join("\n"));
  assert.equal(t.plainCell(edited.cells[0].format),text);
  assert.deepEqual(t.readTable(t.encodeTable(edited)),edited);
  assert.deepEqual(t.editCell(edited,id,edited.cells[0].format),edited);
  const normalize=t.normalizeTableListKeywords;
  assert.equal(normalize("[b]  10.\t열 번째[/b]"),"  10.\t[b]열 번째[/b]");
  assert.equal(normalize("[b]3.14는 원주율[/b]"),"[b]3.14는 원주율[/b]");
  assert.equal(normalize("[b]내용 중 1. 번호[/b]"),"[b]내용 중 1. 번호[/b]");
  assert.equal(normalize("[b][u]1. 항목[/u][/b]"),"[u]1. [/u][b][u]항목[/u][/b]");
});

test("table list normalization preserves inline hyphens, spacing and underline styles",()=>{
  const normalize=t.normalizeTableListKeywords;
  assert.equal(normalize("[b]문제 - 해결[/b]"),"[b]문제 - 해결[/b]");
  assert.equal(normalize("설명 [b]- 중간[/b]"),"설명 [b]- 중간[/b]");
  assert.equal(normalize("[b]  - 첫 항목\r\n\t-둘째 - 항목[/b]"),"  • [b]첫 항목[/b]\r\n\t-[b]둘째 - 항목[/b]");
  const underlined=normalize("[b][u]- 항목[/u][/b]");
  assert.deepEqual(t.cellParts(underlined),[{type:"text",value:"• "},{type:"blank",keyword:"항목"}]);
  assert.equal(underlined,"[u]• [/u][b][u]항목[/u][/b]");
  assert.equal(normalize("[accent]- 항목[/accent]"),"• [accent]항목[/accent]");
  assert.equal(normalize("[b]-[/b]"),"-");
});

test("bold science lists split labels, comma items and lines but retain middle dots",async()=>{
  const {extractBoldKeywords,normalizeAnswerFormat}=await vite.ssrLoadModule("/lib/card-data.ts");
  const lines=[
    "- 과학 가치 : 과학의 심미적 가치, 감수성",
    "- 과학 태도 : 과학 창의성, 유용성, 윤리성, 개방성",
    "- 참여와 실천 : 과학문화 향유, 안전·지속가능 사회에 기여",
  ];
  const expected=["과학 가치","과학의 심미적 가치","감수성","과학 태도","과학 창의성","유용성","윤리성","개방성","참여와 실천","과학문화 향유","안전·지속가능 사회에 기여"];
  for(const format of [`[b]${lines.join("\n")}[/b]`,lines.map(line=>`[b]${line}[/b]`).join("\n")]){
    const normalized=t.normalizeTableListKeywords(format);
    assert.deepEqual(extractBoldKeywords(normalized),expected);
    assert.deepEqual(extractBoldKeywords(normalizeAnswerFormat(normalized,t.plainCell(format))),expected);
    const doc=t.createTable(1,1),edited=t.editCell(doc,doc.cells[0].id,format);
    assert.deepEqual(t.tableKeywords(t.encodeTable(edited)).map(item=>item.keyword),expected);
    assert.equal(t.plainCell(edited.cells[0].format),lines.map(line=>line.replace(/^-/,"•")).join("\n"));
    assert.deepEqual(t.editCell(edited,doc.cells[0].id,edited.cells[0].format),edited);
  }
  assert.deepEqual(extractBoldKeywords(t.normalizeTableListKeywords("[b]가치: 설명[/b]")),["가치","설명"]);
  for(const value of ["12:30","https://example.test","안전·지속가능 사회에 기여"]) {
    assert.equal(t.normalizeTableListKeywords(`[b]${value}[/b]`),`[b]${value}[/b]`);
  }
  const legacy=t.createTable(1,1);
  legacy.cells[0].format="[b]과학 가치 : 과학의 심미적 가치[/b]";
  legacy.cells[0].keywordIds=[t.tableId()];
  assert.deepEqual(t.readTable(t.encodeTable(legacy)),legacy,"reading old cards never reassigns learning identities");
  assert.equal(t.tableKeywords(t.encodeTable(legacy)).length,1);
});

test("explicit newlines split a table bold selection without requiring list dashes",()=>{
  const words=["문제 인식 및 가설 설정","탐구 설계 및 수행","자료  수집·분석 및 해석","결론 도출 및 일반화","의사소통과 협업"];
  for(const newline of ["\n","\r\n","\r"]){
    const text=words.join(newline),original=t.createTable(1,1),id=original.cells[0].id;
    const edited=t.editCell(original,id,`[b]${text}[/b]`);
    assert.deepEqual(t.tableKeywords(t.encodeTable(edited)).map(item=>item.keyword),words);
    assert.equal(edited.cells[0].format,words.map(word=>`[b]${word}[/b]`).join(newline));
    assert.equal(t.plainCell(edited.cells[0].format),text);
    assert.deepEqual(t.readTable(t.encodeTable(edited)),edited);
    assert.deepEqual(t.editCell(edited,id,edited.cells[0].format),edited);
  }
});

test("newline splitting preserves styles, blank lines and separate repeated keyword IDs",()=>{
  const original=t.createTable(1,1),id=original.cells[0].id;
  const format="설명\n[b][u]같은 말\n\n같은 말[/u][/b]\n[accent]긴 문장 안의 공백과 - 기호는 그대로[/accent]\n일반 글자";
  const edited=t.editCell(original,id,format),keywords=t.tableKeywords(t.encodeTable(edited));
  assert.deepEqual(keywords.map(item=>item.keyword),["같은 말","같은 말","긴 문장 안의 공백과 - 기호는 그대로"]);
  assert.equal(new Set(keywords.map(item=>item.keywordKey)).size,3);
  assert.equal(t.plainCell(edited.cells[0].format),t.plainCell(format));
  assert.match(edited.cells[0].format,/\[b\]\[u\]같은 말\[\/u\]\[\/b\]/);
  assert.deepEqual(t.editCell(edited,id,edited.cells[0].format),edited);
});

test("reading legacy bold lists does not reinterpret stored keyword identities",()=>{
  const doc=t.createTable(1,1);
  doc.cells[0].format="[b]- 기존 하나\n- 기존 둘[/b]";
  doc.cells[0].keywordIds=[t.tableId()];
  assert.deepEqual(t.readTable(t.encodeTable(doc)),doc);
  assert.equal(t.tableKeywords(t.encodeTable(doc)).length,1);
});

test("deleting a merged category removes every row it covers",()=>{
  let doc=t.createTable(6,3);
  const rows=[...doc.rows];
  const categoryCells=rows.slice(2,5).map(row=>doc.cells.find(cell=>cell.row===row&&cell.column===doc.columns[0]));
  doc=t.editCell(doc,categoryCells[0].id,"스포츠");
  for(const [index,row] of rows.slice(2,5).entries()){
    const child=doc.cells.find(cell=>cell.row===row&&cell.column===doc.columns[1]);
    doc=t.editCell(doc,child.id,["기술형","전략형","생태형"][index]);
  }
  doc=t.editCell(doc,doc.cells.find(cell=>cell.row===rows[5]&&cell.column===doc.columns[1]).id,"남길 내용");
  doc=t.mergeCells(doc,categoryCells.map(cell=>cell.id));
  const category=doc.cells.find(cell=>t.plainCell(cell.format)==="스포츠");
  assert.equal(category.rowSpan,3);
  const removed=t.removeSelectedTableAxis(doc,"row",category.id);
  assert.deepEqual(removed.rows,[rows[0],rows[1],rows[5]]);
  assert.equal(removed.cells.length,9);
  assert.equal(t.plainCell(removed.cells.find(cell=>cell.row===rows[5]&&cell.column===doc.columns[1]).format),"남길 내용");
  assert.ok(!removed.cells.some(cell=>["스포츠","기술형","전략형","생태형"].includes(t.plainCell(cell.format))));
  assert.deepEqual(t.validateTable(removed),removed);
  assert.equal(doc.rows.length,6);
});

test("deleting a merged cell cannot remove the final table axis",()=>{
  let doc=t.createTable(2,2);
  const merged=t.mergeCells(doc,doc.cells.filter(cell=>cell.column===doc.columns[0]).map(cell=>cell.id));
  const category=merged.cells.find(cell=>cell.rowSpan===2);
  assert.throws(()=>t.removeSelectedTableAxis(merged,"row",category.id),/마지막 행·열/);
  assert.deepEqual(merged.rows,doc.rows);
});

test("legacy thick tables display thin borders and save without changing content or IDs",()=>{
  const doc=sample();doc.cells.forEach((cell,index)=>{cell.border=index%2?3:2;});
  const legacy=t.TABLE_PREFIX+JSON.stringify(doc);
  assert.deepEqual(t.readTable(legacy),doc);
  const saved=t.readTable(t.encodeTable(t.readTable(legacy)));
  assert.ok(saved.cells.every(cell=>cell.border===1));
  assert.deepEqual(saved.cells.map(({border,...cell})=>cell),doc.cells.map(({border,...cell})=>cell));
  assert.deepEqual(t.tableKeywords(t.encodeTable(doc)),t.tableKeywords(legacy));
  assert.equal(doc.cells[0].border,2);
  const source=readFileSync(new URL("../components/table-card.tsx",import.meta.url),"utf8");
  assert.match(source,/borderWidth:1/);
  assert.doesNotMatch(source,/borderWidth:cell\.border/);
});

test("table grading never crosses cells; unordered correction retains exact keyword ID",()=>{
  const doc=sample(),parts=t.tableParts(doc),words=parts.filter(p=>p.type==="blank").map(p=>p.keyword);
  const ev=app.evaluateQuizAnswers(words,["나머지","같은 말","같은 말"],app.quizAnswerOrder(parts));
  assert.equal(ev[0].matched,false);assert.equal(ev[1].matched,true);assert.equal(ev[2].matched,false);
  const ids=app.tableAttemptResults(parts,ev).map(x=>x.keywordKey);assert.equal(new Set(ids).size,3);
  const swapped=app.evaluateQuizAnswers(words,["같은 말","나머지","오답"],app.quizAnswerOrder(parts));
  const corrected=app.quizInlineCorrections(parts,swapped,["같은 말","나머지","오답"]);
  assert.equal(corrected.parts.find(p=>p.type==="blank").keywordId,t.tableKeywords(t.encodeTable(doc))[1].keywordKey);
  const weak=app.keywordReviewParts({answer:t.tableText(doc),answerFormat:t.encodeTable(doc),keywords:words},"같은 말",ids[0]);
  assert.equal(weak.filter(p=>p.type==="blank").length,1);assert.equal(new Set(weak.map(p=>p.cellId)).size,4);
});

test("one table keeps correct words and guides full in-place rewrites",()=>{
  const doc=sample(),parts=t.tableParts(doc);
  const card={id:901,question:"연습 표",questionFormat:"",answer:t.tableText(doc),answerFormat:t.encodeTable(doc),keywords:[]};
  const initial=["같은 말","오답","나머지"];
  const evaluations=app.evaluateQuizAnswers(parts.filter(part=>part.type==="blank").map(part=>part.keyword),initial,app.quizAnswerOrder(parts));
  const corrections=app.quizInlineCorrections(parts,evaluations,initial);
  assert.deepEqual(corrections.answers,[""]);
  const html=renderToStaticMarkup(createElement(app.QuizCloze,{card,partsOverride:corrections.parts,answers:corrections.answers,checked:false,correctionMode:true,onChange:()=>{},onSubmit:()=>{}}));
  assert.equal((html.match(/class="answer-table"/g)||[]).length,1);
  assert.doesNotMatch(html,/내 답 오답|table-inline-review-comparison/);
  assert.match(html,/cloze-field-hint[^>]*>.*같은 말/);
  assert.equal((html.match(/class="cloze-field is-missed/g)||[]).length,1);
  const checked=renderToStaticMarkup(createElement(app.QuizCloze,{card,partsOverride:parts,answers:["같은 말","같은 말","나머지"],checked:true,onChange:()=>{},onSubmit:()=>{}}));
  assert.equal((checked.match(/class="answer-table"/g)||[]).length,1);
  assert.doesNotMatch(checked,/cloze-field-hint/);
  const matched=app.planMatchedQuizAnswer(["사과","배"],["사과",""],1,"배",false);
  assert.equal(matched.allMatched,true);
});

test("guided full practice keeps one editable answer in its original normal or table position",()=>{
  const doc=sample();
  const base={id:990,question:"검증용",questionFormat:"",answer:"첫 줄\n둘째 줄",answerFormat:"",keywords:[],memo:"참고 메모",media:{question:[],answer:[],memo:[]}};
  const normal=renderToStaticMarkup(createElement(app.GuidedFullPractice,{card:base,completed:false,onComplete:()=>{}}));
  assert.match(normal,/첫 줄\n둘째 줄/);
  assert.equal((normal.match(/<textarea/g)||[]).length,1);
  assert.doesNotMatch(normal,/참고 메모/);
  const table=renderToStaticMarkup(createElement(app.GuidedFullPractice,{card:{...base,answer:t.tableText(doc),answerFormat:t.encodeTable(doc)},completed:false,onComplete:()=>{}}));
  assert.equal((table.match(/class="answer-table"/g)||[]).length,1);
  assert.equal((table.match(/<textarea/g)||[]).length,doc.cells.filter(cell=>t.plainCell(cell.format)).length);
  assert.doesNotMatch(table,/참고 메모/);
  const complete=renderToStaticMarkup(createElement(app.GuidedFullPractice,{card:base,completed:true,onComplete:()=>{}}));
  assert.match(complete,/참고 메모/);
  assert.doesNotMatch(complete,/<textarea/);
});

test("correction shows only a matching inline suffix, never a separate answer below the input",()=>{
  const card={id:902,question:"현대 표현 활동(3)",questionFormat:"현대 [b]표현 활동[/b](3)",answer:"라인댄스",answerFormat:"[b]라인댄스[/b]",keywords:[]};
  const parts=[{type:"blank",keyword:"현대 표현 활동"},{type:"text",value:"(3)"}];
  const html=renderToStaticMarkup(createElement(app.QuizCloze,{card,partsOverride:parts,answers:["현대 표현 호"],checked:false,correctionMode:true,onChange:()=>{},onSubmit:()=>{}}));
  assert.match(html,/cloze-field is-missed has-hint is-correction/);
  assert.match(html,/cloze-hint-entered[^>]*>현대 표현 호<\/span><span><\/span>/);
  assert.doesNotMatch(html,/has-mismatch|correction-guide/);
  const prefix=renderToStaticMarkup(createElement(app.QuizCloze,{card,partsOverride:parts,answers:["현대 표현 "],checked:false,correctionMode:true,onChange:()=>{},onSubmit:()=>{}}));
  assert.match(prefix,/cloze-hint-entered[^>]*>현대 표현 <\/span><span>활동<\/span>/);
  assert.equal(app.planMatchedQuizAnswer(["현대 표현 활동","다음 키워드"],["", ""],0,"현대 표현 활동",false).nextIndex,1);
  assert.equal(app.planMatchedQuizAnswer(["현대 표현 활동"],[""],0,"현대 표현 활동",false).allMatched,true);
  assert.equal(app.areQuizCorrectionsComplete(["현대 표현 활동"],["현대 표현 활동"],true),true);
});

test("Tab runs down columns and arrow movement respects merged spans",()=>{
  let doc=t.createTable(3,2);const [a,b,c,d,e,f]=doc.cells;
  assert.equal(t.tableNavigation(doc,doc.cells.map(x=>x.id),a.id,"Tab"),c.id);
  assert.equal(t.tableNavigation(doc,doc.cells.map(x=>x.id),e.id,"Tab"),b.id);
  assert.equal(t.tableNavigation(doc,doc.cells.map(x=>x.id),b.id,"Tab",true),e.id);
  doc=t.mergeCells(doc,[c.id,d.id]);
  assert.equal(t.tableNavigation(doc,doc.cells.map(x=>x.id),b.id,"ArrowDown"),c.id);
  assert.equal(t.tableNavigation(doc,doc.cells.map(x=>x.id),f.id,"ArrowUp"),c.id);
});

test("table blank numbers, Tab, and physical arrows share one cell-aware navigation model",()=>{
  let doc=t.createTable(3,2);
  const [a,b,c,d,e,f]=doc.cells;
  for(const [cell,format] of [[a,"[b]하나[/b], [b]둘[/b]"],[b,"[b]다섯[/b]"],[c,"[b]셋[/b]"],[d,"[b]여섯[/b]"],[e,"[b]넷[/b]"],[f,"[b]일곱[/b]"]])doc=t.editCell(doc,cell.id,format);
  const parts=t.tableParts(doc),active=[0,1,2,3,4,5,6];
  assert.deepEqual(t.tableBlankOrder(doc,parts),[0,1,3,5,2,4,6]);
  assert.deepEqual(t.tableBlankOrder(doc,parts,"horizontal"),[0,1,2,3,4,5,6]);
  assert.equal(t.tableBlankNavigation(doc,parts,active,0,"Tab"),1);
  assert.equal(t.tableBlankNavigation(doc,parts,active,1,"Tab"),3);
  assert.equal(t.tableBlankNavigation(doc,parts,active,3,"Tab",true),1);
  assert.equal(t.tableBlankNavigation(doc,parts,active,5,"Tab"),2);
  assert.equal(t.tableBlankNavigation(doc,parts,active,1,"Tab",false,undefined,"horizontal"),2);
  assert.equal(t.tableBlankNavigation(doc,parts,active,2,"Tab",false,undefined,"horizontal"),3);
  assert.equal(t.tableBlankNavigation(doc,parts,active,3,"Tab",true,undefined,"horizontal"),2);
  assert.equal(t.tableBlankNavigation(doc,parts,active,3,"ArrowRight",false,undefined,"horizontal"),4);
  assert.equal(t.tableBlankNavigation(doc,parts,active,0,"ArrowDown"),3);
  assert.equal(t.tableBlankNavigation(doc,parts,active,3,"ArrowRight"),4);
  assert.equal(t.tableBlankNavigation(doc,parts,active,4,"ArrowLeft"),3);
  assert.equal(t.tableBlankNavigation(doc,parts,active,0,"ArrowRight"),1);
  assert.equal(t.tableBlankNavigation(doc,parts,active,1,"ArrowRight"),2);
  const rects={0:{left:10,right:30,top:10,bottom:30},1:{left:40,right:60,top:10,bottom:30},2:{left:110,right:130,top:10,bottom:30},3:{left:10,right:30,top:50,bottom:70},4:{left:110,right:130,top:50,bottom:70}};
  assert.equal(t.tableBlankNavigation(doc,parts,active,0,"ArrowRight",false,i=>rects[i]??null),1);
  assert.equal(t.tableBlankNavigation(doc,parts,active,1,"ArrowDown",false,i=>rects[i]??null),3);
  const card={id:903,question:"표",answer:t.tableText(doc),answerFormat:t.encodeTable(doc),keywords:[]};
  const html=renderToStaticMarkup(createElement(app.QuizCloze,{card,answers:active.map(()=>""),checked:false,onChange:()=>{},onSubmit:()=>{}}));
  assert.deepEqual(html.match(/placeholder="빈칸 \d+"/g),[1,2,5,3,6,4,7].map(n=>`placeholder="빈칸 ${n}"`));
});

test("table arrows follow wrapped visual lines and cross cells at the edge",()=>{
  let doc=t.createTable(6,3);
  for(let row=0;row<6;row++)doc=t.editCell(doc,doc.cells[row*3+1].id,`[b]분류${row+1}[/b]`);
  doc=t.editCell(doc,doc.cells[2].id,Array.from({length:10},(_,i)=>`[b]상단${i+1}[/b]`).join(", "));
  doc=t.editCell(doc,doc.cells[5].id,Array.from({length:9},(_,i)=>`[b]하단${i+1}[/b]`).join(", "));
  const parts=t.tableParts(doc),numbered=t.tableBlankOrder(doc,parts);
  const rects=new Map();
  const place=(number,left,top)=>rects.set(numbered[number-1],{left,right:left+260,top,bottom:top+40});
  // A tall neighboring answer cell wraps across several lines; entering it
  // from blank 1 must start at its first keyword, not the closest line.
  place(1,267,370);
  place(2,267,472);
  [7,8,9].forEach((n,i)=>place(n,776+i*274,241));
  [10,11,12].forEach((n,i)=>place(n,776+i*274,285));
  [13,14,15].forEach((n,i)=>place(n,776+i*274,370));
  place(16,776,415);
  [17,18,19].forEach((n,i)=>place(n,904+i*274,472));
  [20,21].forEach((n,i)=>place(n,776+i*274,518));
  [22,23,24].forEach((n,i)=>place(n,904+i*274,562));
  place(25,776,606);
  const active=[2,...Array.from({length:19},(_,i)=>i+7)].map(n=>numbered[n-1]);
  const move=(from,key,indices=active)=>{
    const result=t.tableBlankNavigation(doc,parts,indices,numbered[from-1],key,false,i=>rects.get(i)??null);
    return result===null?null:numbered.indexOf(result)+1;
  };
  assert.equal(move(1,"ArrowRight",[numbered[0],...active]),7);
  assert.equal(move(2,"ArrowUp"),7);
  assert.equal(move(15,"ArrowRight"),16);
  assert.equal(move(17,"ArrowDown"),20);
  assert.equal(move(22,"ArrowLeft"),2);
  assert.equal(move(22,"ArrowUp"),20);
  assert.equal(move(23,"ArrowUp"),21);
  assert.equal(move(21,"ArrowUp"),18);
  assert.equal(move(18,"ArrowUp"),16);
});

test("editor Tab moves right, Enter down, and only these keys grow at the edge",()=>{
  const doc=t.createTable(2,2),[a,b,c,d]=doc.cells;
  assert.equal(t.tableEditorMove(doc,a.id,"Tab").targetId,b.id);
  assert.equal(t.tableEditorMove(doc,b.id,"Tab",true).targetId,a.id);
  assert.equal(t.tableEditorMove(doc,a.id,"Enter").targetId,c.id);
  assert.equal(t.tableEditorMove(doc,a.id,"ArrowLeft"),null);
  assert.equal(t.tableEditorMove(doc,d.id,"ArrowRight"),null);
  assert.equal(t.tableEditorMove(doc,d.id,"ArrowDown"),null);
  const moreCols=t.tableEditorMove(doc,b.id,"Tab");
  assert.equal(moreCols.doc.columns.length,3);assert.equal(moreCols.doc.rows.length,2);
  assert.equal(moreCols.doc.cells.find(x=>x.id===moreCols.targetId).row,a.row);
  const moreRows=t.tableEditorMove(doc,d.id,"Enter");
  assert.equal(moreRows.doc.rows.length,3);assert.equal(moreRows.doc.columns.length,2);
  assert.equal(moreRows.doc.cells.find(x=>x.id===moreRows.targetId).column,d.column);
  assert.ok(doc.cells.every(x=>moreRows.doc.cells.some(y=>y.id===x.id)));
  const merged=t.mergeCells(doc,[a.id,b.id]);
  assert.equal(t.tableEditorMove(merged,a.id,"Tab").doc.columns.length,3);
  assert.equal(t.tableEditorMove(merged,d.id,"ArrowUp").targetId,a.id);
});

test("empty-axis deletion at terminal cell preserves content, IDs, and minimum dimensions",()=>{
  let doc=t.createTable(3,3);
  doc=t.editCell(doc,doc.cells[0].id,"[b]기존 기록[/b]");
  const original=t.tableKeywords(t.encodeTable(doc));
  const last=doc.cells.at(-1);
  assert.equal(t.removeEmptyTableAxis(doc,doc.cells[4].id),null);
  const row=t.removeEmptyTableAxis(doc,last.id,"row");
  assert.equal(row.doc.rows.length,2);assert.equal(row.doc.columns.length,3);
  const col=t.removeEmptyTableAxis(doc,last.id,"column");
  assert.equal(col.doc.rows.length,3);assert.equal(col.doc.columns.length,2);
  assert.deepEqual(t.tableKeywords(t.encodeTable(row.doc)),original);
  assert.deepEqual(t.tableKeywords(t.encodeTable(col.doc)),original);
  doc=t.editCell(doc,doc.cells[6].id,"삭제하면 안 되는 행");
  doc=t.editCell(doc,doc.cells[2].id,"삭제하면 안 되는 열");
  assert.equal(t.removeEmptyTableAxis(doc,last.id),null);
  const one=t.createTable(1,1);assert.equal(t.removeEmptyTableAxis(one,one.cells[0].id),null);
  const merged=t.mergeCells(doc,[doc.cells[3].id,doc.cells[6].id]);
  assert.equal(t.removeEmptyTableAxis(merged,last.id),null);
});

test("table layout favors content, and physical shortcuts work with Korean input mode",()=>{
  let doc=t.createTable(2,3);
  doc=t.editCell(doc,doc.cells[0].id,"영역");
  doc=t.editCell(doc,doc.cells[1].id,"세부 영역");
  doc=t.editCell(doc,doc.cells[2].id,"기본 체력운동의 방법과 신체활동의 다양한 예시");
  const widths=t.tableColumnWidths(doc);assert.ok(widths[0]<widths[1]);assert.ok(widths[1]<widths[2]);assert.ok(widths.every(x=>x>=56&&x<=560));
  assert.equal(widths[0],56);assert.equal(t.tableColumnWidths(doc,true)[0],76);
  assert.equal(t.tableColumnTracks(doc),widths.map(width=>`minmax(0, ${Math.max(80,Math.min(480,width))}fr)`).join(" "));
  const event={ctrlKey:true,metaKey:false,altKey:false,shiftKey:false};
  assert.equal(t.tableEditorShortcut({...event,key:"ㅡ",code:"KeyM"}),"merge");
  assert.equal(t.tableEditorShortcut({...event,key:"ㅔ",code:"KeyP"}),"shade");
  assert.equal(t.tableEditorShortcut({...event,key:"ㅠ",code:"KeyB"}),"bold");
  assert.equal(t.tableEditorShortcut({...event,key:"ㅋ",code:"KeyZ",shiftKey:true}),"redo");
  assert.equal(t.tableEditorShortcut({...event,key:"p",code:"KeyP",ctrlKey:false}),null);
});

test("table editor halves spare label width and gives it to long descriptions without changing saved data",()=>{
  let doc=t.createTable(3,3);
  for(const [index,text] of [[0,"영역"],[1,"활동"],[2,"예시 활동"],[3,"[b]자율·자치[/b] 활동"],[4,"[b]학술·문화 및 여가[/b] 활동"],[5,"- 주제 탐구 활동 : 개인 연구, 소집단 공동 연구, 프로젝트\n- 적응 및 개척 활동 : 입학 초기 적응, 학교 이해, 정체성 지원, 관계 형성"]])doc=t.editCell(doc,doc.cells[index].id,text);
  doc=t.editCell(doc,doc.cells[8].id,"예시 활동의 긴 설명 ".repeat(20));
  const saved=t.encodeTable(doc),natural=t.tableColumnWidths(doc,true);
  const weights=natural.map(width=>Math.max(80,Math.min(480,width))),total=weights.reduce((a,b)=>a+b,0);
  const parse=tracks=>[...tracks.matchAll(/([\d.]+)fr/g)].map(match=>Number(match[1]));
  const before=weights.map(width=>1200*width/total);
  const after=parse(t.tableColumnTracks(doc,true,{},1200));
  for(const index of [0,1]){
    assert.ok(before[index]>natural[index]);
    assert.ok(Math.abs((after[index]-natural[index])/(before[index]-natural[index])-.5)<.0001,"spare label space is halved");
    assert.ok(after[index]>=natural[index],"labels retain their natural text width");
  }
  assert.ok(after[2]>before[2],"descriptions receive all freed space");
  assert.ok(Math.abs(after.reduce((a,b)=>a+b,0)-1200)<.001);
  assert.equal(t.tableColumnTracks(doc,false,{},1200),t.tableColumnTracks(doc),"reading/study layout is unchanged");
  assert.equal(t.tableColumnTracks(doc,true,{},200),t.tableColumnTracks(doc,true),"narrow layouts do not further squeeze labels");
  assert.equal(t.encodeTable(doc),saved);
  const empty=t.createTable(2,3);
  assert.equal(t.tableColumnTracks(empty,true,{},1200),t.tableColumnTracks(empty,true),"empty/equal columns stay balanced");
  const merged=t.mergeCells(doc,[doc.cells[6].id,doc.cells[7].id]);
  assert.equal(parse(t.tableColumnTracks(merged,true,{},1200)).length,3,"merged cells keep their geometry");
});

test("equal column widths replace prior locks without changing cells, IDs or source content",()=>{
  let doc=sample();doc=t.resizeTable(doc,"column",2);
  const locked=t.toggleTableColumnWidthLocks(doc,[doc.cells[0].id],[100,250,650]);
  const original=t.encodeTable(locked),next=t.equalizeTableColumnWidths(locked);
  assert.deepEqual(next.columnWidthLocks,Object.fromEntries(doc.columns.map(id=>[id,1/3])));
  assert.deepEqual(next.cells,locked.cells);assert.deepEqual(next.rows,locked.rows);assert.deepEqual(next.columns,locked.columns);
  assert.deepEqual(t.tableKeywords(t.encodeTable(next)),t.tableKeywords(original));
  assert.equal(t.encodeTable(locked),original);
  assert.equal(t.equalizeTableColumnWidths(next),next,"already equal is not another history step");
  assert.deepEqual(t.readTable(t.encodeTable(next)).columnWidthLocks,next.columnWidthLocks);
  const event={key:"=",code:"Equal",ctrlKey:true,metaKey:false,shiftKey:false,altKey:false};
  assert.equal(t.tableEditorShortcut(event),null,"equal widths has no keyboard shortcut");
  const css=readFileSync(new URL("../components/table-card.css",import.meta.url),"utf8");
  assert.match(css,/\.answer-table-cell:not\(\.shade-0\)\{display:flex;align-items:center;justify-content:center\}/);
  const gray={...doc,cells:doc.cells.map(cell=>({...cell,shade:1}))};
  const merged=t.mergeCells(gray,gray.cells.slice(0,2).map(cell=>cell.id));
  assert.equal(merged.cells.find(cell=>cell.colSpan===2).shade,1);
});

test("manual column resizing transfers adjacent space, clamps widths and preserves content/identities",()=>{
  const doc=t.createTable(2,3),original=t.encodeTable(doc);
  const widths=[200,300,500];
  const resized=t.resizeTableColumnBoundary(doc,0,80,widths);
  assert.deepEqual(resized.columnWidthLocks,{[doc.columns[0]]:.28,[doc.columns[1]]:.22});
  assert.deepEqual(resized.cells,doc.cells);assert.deepEqual(resized.rows,doc.rows);
  assert.equal(t.encodeTable(doc),original);assert.deepEqual(widths,[200,300,500]);
  assert.deepEqual(t.readTable(t.encodeTable(resized)).columnWidthLocks,resized.columnWidthLocks);
  const clamped=t.resizeTableColumnBoundary(doc,1,9999,widths);
  assert.equal(clamped.columnWidthLocks[doc.columns[2]],.048);
  const small=t.resizeTableColumnBoundary(doc,0,-999,[20,20,30]);
  assert.ok(small.columnWidthLocks[doc.columns[0]]>0);
  const locked=t.toggleTableColumnWidthLocks(doc,doc.cells.map(cell=>cell.id),widths);
  const all=t.resizeTableColumnBoundary(locked,1,-80,widths);
  assert.deepEqual(Object.values(all.columnWidthLocks),[.2,.22,.58]);
  assert.equal(t.resizeTableColumnBoundary(doc,0,0,widths),doc);
  assert.equal(t.resizeTableColumnBoundary(doc,-1,30,widths),doc);
  assert.equal(t.resizeTableColumnBoundary(doc,2,30,widths),doc);
  assert.equal(t.resizeTableColumnBoundary(doc,0,NaN,widths),doc);
  assert.throws(()=>t.resizeTableColumnBoundary(doc,0,30,[100,NaN,100]));
  assert.throws(()=>t.resizeTableColumnBoundary(doc,0,30,[100,100]));
});

test("column width locks round-trip and remain independent of content with reversible selected-column toggles",async()=>{
  let doc=t.createTable(2,3);
  doc=t.editCell(doc,doc.cells[3].id,"[b]고정 열[/b]");
  const words=t.tableKeywords(t.encodeTable(doc));
  const locked=t.toggleTableColumnWidthLocks(doc,[doc.cells[0].id],[180,270,550]);
  assert.deepEqual(locked.columnWidthLocks,{[doc.columns[0]]:.18});
  const changed=t.editCell(t.editCell(locked,doc.cells[3].id,"[b]고정 열[/b] "+"긴 내용 ".repeat(40)),doc.cells[4].id,"다른 열 내용 ".repeat(100));
  assert.equal(t.tableColumnTracks(changed,true,{},1000).split(" ").slice(0,2).join(" "),"minmax(0, 18%)");
  assert.deepEqual(t.readTable(t.encodeTable(changed)).columnWidthLocks,locked.columnWidthLocks);
  assert.deepEqual(t.tableKeywords(t.encodeTable(changed)),words,"keyword identity and records stay attached");
  assert.deepEqual(t.toggleTableColumnWidthLocks(locked,[doc.cells[0].id],[]).columnWidthLocks,{},"unlocking does not need a measurement");
  assert.equal(t.toggleTableColumnWidthLocks(doc,[],[]),doc);
  assert.throws(()=>t.toggleTableColumnWidthLocks(doc,[doc.cells[0].id],[NaN,100,100]));
  const merged=t.mergeCells(doc,[doc.cells[0].id,doc.cells[1].id]);
  assert.deepEqual(t.selectedTableColumns(merged,[merged.cells.find(cell=>cell.colSpan===2).id]),doc.columns.slice(0,2));
  const multiple=t.toggleTableColumnWidthLocks(doc,[doc.cells[0].id,doc.cells[2].id],[180,270,550]);
  assert.equal(Object.keys(multiple.columnWidthLocks).length,2);
  const all=t.toggleTableColumnWidthLocks(doc,doc.cells.map(cell=>cell.id),[180,270,550]);
  const added=t.resizeTable(all,"column",3);
  assert.ok(Object.values(added.columnWidthLocks).reduce((sum,n)=>sum+n,0)<1,"a new column has usable room even after all columns were locked");
  const removed=t.resizeTable(all,"column",0,true);
  assert.equal(removed.columnWidthLocks[doc.columns[0]],undefined);
  assert.ok(Math.abs(Object.values(removed.columnWidthLocks).reduce((sum,n)=>sum+n,0)-1)<.00001);
  assert.deepEqual(t.resizeTable(locked,"row",2).columnWidthLocks,locked.columnWidthLocks);
  for(const locks of [{unknown:.5},{[doc.columns[0]]:-1},{[doc.columns[0]]:NaN},{[doc.columns[0]]:.8,[doc.columns[1]]:.8}])assert.throws(()=>t.validateTable({...doc,columnWidthLocks:locks}));
  const templates=await vite.ssrLoadModule("/lib/table-template.ts");
  const copy=templates.instantiateTableTemplate(t.encodeTable(all));
  assert.deepEqual(Object.values(copy.columnWidthLocks),Object.values(all.columnWidthLocks));
  assert.ok(Object.keys(copy.columnWidthLocks).every(id=>copy.columns.includes(id)&&!doc.columns.includes(id)));
  const cropped=templates.selectedTableTemplate(all,doc.cells.slice(0,2).map(cell=>cell.id));
  assert.equal(Object.keys(cropped.columnWidthLocks).length,2);
  assert.ok(Object.keys(cropped.columnWidthLocks).every(id=>cropped.columns.includes(id)));
  const draft=await vite.ssrLoadModule("/lib/table-editor-draft.ts");
  assert.equal(draft.hasUnsavedTableContent(locked,draft.tableDraftSignature(doc)),true,"lock-only edits on written tables are protected");
  assert.equal(draft.hasUnsavedTableContent(locked,draft.tableDraftSignature(locked)),false);
  const event={key:"\\",code:"Backslash",ctrlKey:true,metaKey:false,altKey:false,shiftKey:false};
  assert.equal(t.tableEditorShortcut(event),"widthLock");
  assert.equal(t.tableEditorShortcut({...event,ctrlKey:false,metaKey:true}),"widthLock");
  assert.equal(t.tableEditorShortcut({...event,code:"",key:"\\"}),"widthLock");
  assert.equal(t.tableEditorShortcut({...event,key:"₩"}),"widthLock");
  assert.equal(t.tableEditorShortcut({...event,code:"",key:"₩"}),"widthLock");
  assert.equal(t.tableEditorShortcut({...event,key:"|",shiftKey:true}),null,"Safari tab overview with Shift remains available");
  assert.equal(t.tableEditorShortcut({...event,key:"9",code:"Digit9"}),null,"Ctrl/Cmd+9 keeps its browser action");
  assert.equal(t.tableEditorShortcut({...event,key:"(",code:"Digit9",shiftKey:true}),null,"the former three-key binding is removed");
  assert.equal(t.tableEditorShortcut({...event,key:"h",code:"KeyH",shiftKey:false}),null,"old Ctrl/Cmd+H is no longer intercepted");
  assert.equal(t.tableEditorShortcut({...event,key:"ㅗ",code:"KeyH",shiftKey:false}),null);
  assert.equal(t.tableEditorShortcut({...event,altKey:true}),null);
  assert.equal(t.tableEditorShortcut({...event,ctrlKey:false,metaKey:false}),null);
});

test("table tracks fit available space and cells wrap with shade-specific alignment",()=>{
  let doc=t.createTable(2,2);
  doc=t.editCell(doc,doc.cells[0].id,"가".repeat(80));
  doc=t.editCell(doc,doc.cells[1].id,"제목\n두 번째 줄");
  const widths=t.tableColumnWidths(doc);
  assert.equal(widths[0],80*16+24);
  assert.equal(widths[1],4*16+2*8+24);
  assert.ok(widths[0]>560);
  assert.ok(t.tableColumnWidths(doc,true)[0]>widths[0]);
  const merged=t.mergeCells(doc,[doc.cells[2].id,doc.cells[3].id]);
  const longMerged=t.editCell(merged,merged.cells.find(cell=>cell.colSpan===2).id,"나".repeat(120));
  assert.ok(t.tableColumnWidths(longMerged).reduce((a,b)=>a+b,0)>=120*16+24);
  const actual=t.tableColumnWidths(doc,false,{[doc.cells[0].id]:1600,[doc.cells[1].id]:100});
  assert.deepEqual(actual,[1624,124]);
  const css=readFileSync(new URL("../components/table-card.css",import.meta.url),"utf8");
  assert.equal(t.tableColumnTracks(doc),"minmax(0, 480fr) minmax(0, 104fr)");
  assert.match(css,/\.answer-table\{[^}]*min-width:0;[^}]*white-space:pre-wrap;/);
  assert.match(css,/\.answer-table-scroll\{[^}]*overflow:visible/);
  assert.match(css,/\.answer-table-cell\{[^}]*text-align:left/);
  assert.match(css,/\.answer-table-cell:not\(\.shade-0\)\{text-align:center\}/);
  assert.match(css,/\.answer-table-cell-content\{[^}]*width:100%;[^}]*white-space:pre-wrap/);
  const component=readFileSync(new URL("../components/table-card.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(component,/minWidth:naturalWidth|transform:`scale/);
});

test("viewer ratios resolve the same editor tracks and preserve saved width locks",()=>{
  let doc=t.createTable(2,3);doc=t.editCell(doc,doc.cells[2].id,"긴 설명 ".repeat(30));
  const original=t.encodeTable(doc),weights=t.tableColumnTracks(doc,true,{},1140).matchAll(/([\d.]+)fr/g);
  const values=[...weights].map(match=>Number(match[1])),sum=values.reduce((a,b)=>a+b,0);
  assert.deepEqual(t.tableEditorColumnRatios(doc,1140),values.map(value=>value/sum));
  const partial=t.toggleTableColumnWidthLocks(doc,[doc.cells[0].id],[200,300,500]);
  const ratios=t.tableEditorColumnRatios(partial,1140);
  assert.equal(ratios[0],.2);assert.ok(Math.abs(ratios.reduce((a,b)=>a+b,0)-1)<1e-10);
  const locked=t.toggleTableColumnWidthLocks(doc,doc.cells.map(cell=>cell.id),[200,300,500]);
  assert.deepEqual(t.tableEditorColumnRatios(locked,300),[.2,.3,.5]);
  assert.deepEqual(t.tableEditorColumnRatios(locked,1600),[.2,.3,.5]);
  assert.deepEqual(t.tableEditorColumnRatios(t.createTable(1,1),300),[1]);
  assert.equal(t.encodeTable(doc),original);
});

test("full-screen tables retain editor proportions and fit the viewer without clipping",()=>{
  const css=readFileSync(new URL("../components/table-card.css",import.meta.url),"utf8");
  const component=readFileSync(new URL("../components/table-card.tsx",import.meta.url),"utf8");
  assert.match(component,/contentSized \? `repeat\(\$\{doc\.columns\.length\}, max-content\)` : tableColumnTracks/);
  assert.match(component,/className="table-viewer-body" ref=\{setViewerBody\}>\{grid\(true\)\}/);
  assert.match(component,/\[open, rotated, mobileViewer, viewport.width, viewport.height, doc, viewerBody, viewerLayout\]/,"the viewer recalculates after its portal body and proportions are ready");
  assert.match(component,/columnRatios=\{contentSized\?viewerLayout\?\.ratios:undefined\}/);
  assert.match(component,/tableEditorColumnRatios\(doc,referenceWidth/);
  assert.match(css,/\.table-viewer-body \.answer-table\.is-proportional\{width:var\(--table-viewer-width,100%\)\}/);
  assert.match(css,/\.is-proportional \.answer-table-cell-content\{white-space:pre-wrap;overflow-wrap:anywhere/);
  assert.match(component,/: 16\.5;/,"desktop tables use the same intermediate text size");
  assert.match(component,/while \(desktopSize > 13\.5 && \(table\.scrollWidth > fitWidth \|\| table\.scrollHeight > fitHeight\)\)/,"desktop viewer fits oversized tables before scrolling");
  assert.match(component,/const frameGap = 32/);
  assert.match(component,/table\.scrollWidth \+ frameGap \* 2 \+ frameAllowance/);
  assert.match(component,/table\.scrollHeight \+ frameGap \* 2 \+ frameAllowance/,"desktop frame reserves equal space around the table");
  assert.match(component,/mobileViewer\?\(rotated\?viewport\.height:viewport\.width\)/,"mobile uses the full visible viewport");
  assert.match(css,/\.table-viewer-dialog\.is-mobile\{padding:0;border:0;border-radius:0\}/);
  assert.doesNotMatch(css,/table-viewer-rotate/);
  assert.match(css,/\.table-viewer-dialog>\[data-slot=dialog-close\]\{[^}]*z-index:4/);
  assert.match(css,/\.table-viewer-dialog>\[data-slot=dialog-close\]\{[^}]*border:0;[^}]*background:transparent;[^}]*box-shadow:none/);
  assert.match(css,/\.table-viewer-dialog:not\(\.is-mobile\)>\[data-slot=dialog-close\]\{[^}]*color:#9ba3a0/);
  assert.match(css,/\.table-viewer-dialog:not\(\.is-mobile\)>\[data-slot=dialog-close\]:hover,[^{]*\{color:#34443d\}/);
  assert.match(css,/\.table-viewer-dialog\[data-slot=dialog-content\]\{padding:2px 4px/);
  assert.match(css,/\.table-viewer-body \.answer-table\.is-content-sized\{width:max-content;max-width:none/);
  assert.match(css,/\.table-viewer-body \.answer-table\.is-content-sized \.answer-table-cell-content\{white-space:pre;overflow-wrap:normal/);
  assert.match(css,/\.table-viewer-dialog:not\(\.is-mobile\)\[data-slot=dialog-content\]\{padding:32px\}/);
  assert.doesNotMatch(css,/\.table-viewer-dialog:not\(\.is-mobile\) \.answer-table\.is-content-sized \.answer-table-cell\{padding:/);
  assert.equal(t.tableViewerFontSize(1000,500,1800,900,14),24.5);
  assert.equal(t.tableViewerFontSize(2000,500,1200,900,14),14,"a wide table scrolls instead of shrinking to unreadable text or wrapping");
  assert.ok(t.tableViewerFontSize(1000,700,1800,900,14)<t.tableViewerFontSize(1000,500,1800,900,14));
  assert.equal(t.tableViewerMobileFontSize(850,430,844,390,14),12.5,"landscape can avoid small overflows");
  assert.equal(t.tableViewerMobileFontSize(850,430,390,844,14),14,"portrait keeps readable text and scrolls only where necessary");
});

test("table selection separates touch selection from editing and Escape preserves the dialog",()=>{
  const source=readFileSync(new URL("../components/table-card.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(source,/table-cell-select|>✓<|칸 선택 버튼/);
  assert.match(source,/contentEditable=\{editing\}/);
  assert.match(source,/onEdit&&!extend&&\(again\|\|event.detail>1\)/);
  assert.match(source,/flushSync\(\(\)=>\{setSelected\(\[cell.id\]\);setEditingCellId\(cell.id\);\}\)/);
  assert.match(source,/data-photo-back="111" onClick=\{back\}/);
  assert.match(source,/if\(editingCellId\)\{endEditing\(\);return;\}\s*if\(selected.length\)\{\s*setSelected\(\[\]\);selectionAnchor.current=null;[\s\S]*?focus\(\{preventScroll:true\}\);\s*return;\s*\}\s*requestClose\(\)/);
  assert.match(source,/setEditingCellId\(move.targetId\);focusTarget.current=move.targetId/);
  assert.match(source,/aria-pressed=\{multiSelect\}/);
});

test("card library keeps equal tiles and opens table content only on demand",()=>{
  const app=readFileSync(new URL("../app/study-app.tsx",import.meta.url),"utf8");
  const css=readFileSync(new URL("../app/globals.css",import.meta.url),"utf8");
  const table=readFileSync(new URL("../components/table-card.tsx",import.meta.url),"utf8");
  assert.match(app,/const tableDoc = readTable\(card\.answerFormat\)/);
  assert.match(app,/tableDoc \? <div className="library-table-preview"><TableAnswer doc=\{tableDoc\} buttonOnly \/><\/div> : <p><AnswerContent card=\{card\} \/><\/p>/);
  assert.match(css,/\.library-card \{[^}]*height: 300px;[^}]*overflow: hidden/);
  assert.match(table,/buttonOnly \? <button type="button" className="table-preview-open" onClick=\{openViewer\}/);
  assert.match(table,/>표 확인하기<\/button>/);
  assert.match(table,/<Dialog open=\{open\}/);
});

test("table mobile viewer opens sideways automatically and shortcut help wraps without a scroller",()=>{
  const source=readFileSync(new URL("../components/table-card.tsx",import.meta.url),"utf8");
  const css=readFileSync(new URL("../components/table-card.css",import.meta.url),"utf8");
  assert.match(source,/<DialogTitle>표 편집 사용법<\/DialogTitle>/);
  assert.match(source,/const rotated = mobileViewer && viewport\.width < viewport\.height;/);
  assert.doesNotMatch(source,/setLandscape|table-viewer-rotate|RotateCw/);
  assert.match(css,/\.table-edit-help\{[^}]*white-space:normal;overflow-wrap:anywhere/);
  assert.doesNotMatch(css,/\.table-edit-help\{[^}]*overflow-x:auto/);
  assert.match(source,/width:mobileViewer\?\(rotated\?viewport.height:viewport.width\)/);
  assert.match(source,/rotate\(90deg\)/);
  assert.match(source,/className="table-edit-dock" role="toolbar"/);
  assert.match(source,/aria-label=\{canUnmerge\?"병합 해제":"병합"\}/);
  assert.doesNotMatch(source,/화면 너비에 맞춰 내용을 줄바꿈해 보여줘요/);
});

test("hint resets only retain a correct prefix and remount stale IME fields",()=>{
  assert.deepEqual(app.planQuizHint("기본", "도자기"),{stage:1,answer:""});
  assert.deepEqual(app.planQuizHint("기본", "기차"),{stage:2,answer:"기"});
  const source=readFileSync(new URL("../app/study-app.tsx",import.meta.url),"utf8");
  assert.match(source,/key=\{`input-\$\{currentIndex\}-\$\{savedHint\?\.revision \?\? 0\}`\}/);
  assert.match(source,/latestHintsRef.current\[currentIndex\] !== savedHint/);
  assert.match(source,/data-mobile-cloze-card=\{card.id\}/);
  assert.match(source,/table-inline-blank \$\{evaluation\.matched \? "is-correct" : "is-missed"\}/);
  assert.match(source,/mobileSubmitOnLast=\{Boolean\(currentStudyTable\)\}/);
  assert.doesNotMatch(source,/if \(!\(mobileTable && mobileSubmitOnLast\)\) onSubmit\(pending\.answers\)/);
  assert.match(source,/if \(pending\.allMatched\) \{[\s\S]*?onSubmit\(pending\.answers\);\s*return;/);
  assert.doesNotMatch(source,/table-input-toolbar|has-table-input-toolbar/);
  assert.match(source,/if \(mobileGradeReady\) \{/);
  assert.match(source,/!answered && studySessionMode === "real" && \(\s*<Button size="lg" onClick=\{\(\) => gradeStudyKeywords\(\)\}/);
  assert.match(source,/viewport\.height, viewport\.top, viewport\.width/);
  assert.match(source,/frame\.bottom - viewport\.top - viewport\.height/);
  assert.match(source,/Math\.ceil\(input\.scrollHeight \* scale\)/);
  const css=readFileSync(new URL("../components/table-card.css",import.meta.url),"utf8");
  assert.match(css,/padding-bottom:calc\(16px \+ var\(--table-keyboard-inset,0px\)\)/);
  assert.match(css,/font-size:calc\(\.875rem - 1pt\)/);
});

test("wrapped and spanning table cells reserve their actual content height",()=>{
  const source=readFileSync(new URL("../components/table-card.tsx",import.meta.url),"utf8");
  const css=readFileSync(new URL("../components/table-card.css",import.meta.url),"utf8");
  assert.match(source,/Math\.max\(content\.offsetHeight, content\.scrollHeight\)/);
  assert.match(source,/new ResizeObserver\(\(\)=>\{cancelAnimationFrame\(frame\);frame=requestAnimationFrame\(measure\);\}\)/,"height remeasurement is deferred to avoid resize loops while columns change");
  assert.match(source,/observer\.disconnect\(\)/);
  assert.match(source,/setProperty\("--table-cell-min-height", value\)/);
  assert.match(css,/grid-auto-rows:minmax\(min-content,auto\)/);
  assert.match(css,/min-height:var\(--table-cell-min-height,32px\)/);
});

test("rotated tables map touch axes and editor controls leave space for the caret",()=>{
  const source=readFileSync(new URL("../components/table-card.tsx",import.meta.url),"utf8");
  assert.match(source,/body.scrollTop \+= point.clientX-touch.x/);
  assert.match(source,/body.addEventListener\("touchmove",move,\{passive:false\}\)/);
  assert.match(source,/body.removeEventListener\("touchmove",move\)/);
  assert.doesNotMatch(source,/굵은 글씨만 빈칸으로 출제돼요/);
  assert.ok(source.indexOf('className="table-editor-body"') < source.indexOf('className="table-editor-toolbar"'));
  assert.ok(source.indexOf('className="table-editor-history"') < source.indexOf('className="table-editor-body"'));
  assert.match(source,/keepTableCaretVisible\(rootRef.current\)/);
  assert.match(source,/document.addEventListener\("selectionchange",reveal\)/);
});

test("table API save/reopen and separate keyword records; partial never advances mastery",async()=>{
  const cards=await vite.ssrLoadModule("/app/api/cards/route.ts"),reviews=await vite.ssrLoadModule("/app/api/reviews/route.ts"),stats=await vite.ssrLoadModule("/app/api/keyword-stats/route.ts");
  const doc=sample(),format=t.encodeTable(doc),words=t.tableKeywords(format);
  const response=await cards.POST(request({subject:"체육",section:"내용체계",question:"표 제목",answer:t.tableText(doc),answerFormat:format,keywordsFromBold:true}));
  const body=await response.json();assert.equal(response.status,201,JSON.stringify(body));const cardId=body.card.id;
  const reopened=await(await cards.GET(new Request("https://test.invalid/api/cards",{headers}))).json();assert.equal(reopened.cards[0].answerFormat,format);assert.equal(reopened.cards.length,1);
  const result=await stats.POST(request({eventId:"table-keyword-attempt",cardId,results:words.map((word,index)=>({...word,matched:index!==0}))}));assert.equal(result.status,200,await result.text());
  const stored=db.prepare("SELECT keyword_key,attempts,correct_count FROM keyword_stats ORDER BY keyword_key").all();assert.equal(stored.length,3);assert.equal(stored.filter(x=>x.correct_count===0).length,1);
  const partial=await reviews.POST(request({eventId:"partial-table-result",cardId,mode:"write",result:"correct",tableKeywordIds:[words[0].keywordKey]}));assert.equal(partial.status,200);
  assert.equal(db.prepare("SELECT correct_count FROM cards WHERE id=?").get(cardId).correct_count,0);
  assert.equal(db.prepare("SELECT coverage FROM reviews WHERE event_id=?").get("partial-table-result").coverage,"partial");
  const full={eventId:"full-table-result",cardId,mode:"write",result:"correct",tableKeywordIds:words.map(x=>x.keywordKey)};
  assert.equal((await reviews.POST(request(full))).status,200);assert.equal((await reviews.POST(request(full))).status,200);
  assert.equal(db.prepare("SELECT correct_count FROM cards WHERE id=?").get(cardId).correct_count,1);
});

test("photo drafts retain geometry but never infer bold keywords",async()=>{
  const {importedTable}=await vite.ssrLoadModule("/lib/table-import.ts");
  const doc=importedTable({rows:2,columns:2,cells:[{row:0,column:0,rowSpan:1,colSpan:2,text:"[b]영역[/b]",shade:3,border:2},{row:1,column:0,rowSpan:1,colSpan:1,text:"가",shade:0,border:1},{row:1,column:1,rowSpan:1,colSpan:1,text:"나",shade:1,border:1}]});
  assert.equal(doc.cells[0].colSpan,2);assert.equal(doc.cells[0].shade,3);assert.equal(t.tableKeywords(t.encodeTable(doc)).length,0);
  const edited=t.editCell(doc,doc.cells[1].id,"[b]가[/b]");assert.equal(t.tableKeywords(t.encodeTable(edited)).length,1);
});

test("all card write routes keep normalized list text, keywords and archive history consistent",async()=>{
  const create=await vite.ssrLoadModule("/app/api/cards/route.ts");
  const batch=await vite.ssrLoadModule("/app/api/cards/batch/route.ts");
  const single=await vite.ssrLoadModule("/app/api/cards/[id]/route.ts");
  const organize=await vite.ssrLoadModule("/app/api/cards/organize/route.ts");
  const subject="다양한 목록 저장 검증";
  const original={subject,section:"기본",question:"○ 질문",questionFormat:"○ [u]질문[/u]",answer:"● 정답\n    ▪ 설명",answerFormat:"[b]● 정답\n    ▪ 설명[/b]",memo:"· 메모",keywordsFromBold:true};
  const created=await create.POST(request(original));assert.equal(created.status,201);
  const card=(await created.json()).card;
  assert.equal(card.question,"• 질문");assert.equal(card.answer,"• 정답\n    • 설명");
  assert.equal(t.plainCell(card.answerFormat),card.answer);assert.deepEqual(card.keywords,["정답","설명"]);
  // A legacy row already has the same keyword boundaries; only its glyphs differ.
  const legacyFormat="● [b]정답[/b]\n    ▪ [b]설명[/b]";
  db.prepare("UPDATE cards SET answer=?,answer_format=?,archived_at='2026-10-01',keyword_success_streak=3,full_write_success_streak=2,correct_count=9 WHERE id=?").run(original.answer,legacyFormat,card.id);
  const updated=await single.PATCH(request({...original,answerFormat:legacyFormat}),{params:Promise.resolve({id:String(card.id)})});
  assert.equal(updated.status,200);
  const saved=(await updated.json()).card;
  assert.equal(saved.archivedAt,"2026-10-01");assert.equal(saved.keywordSuccessStreak,3);assert.equal(saved.fullWriteSuccessStreak,2);assert.equal(saved.correctCount,9);
  const ordered=await organize.POST(request({subject,cards:[{...saved,answer:original.answer,answerFormat:legacyFormat}]}));
  assert.equal(ordered.status,200);
  const reordered=(await ordered.json()).cards[0];
  assert.equal(reordered.answer,card.answer);assert.equal(reordered.archivedAt,"2026-10-01");assert.deepEqual(reordered.keywords,card.keywords);

  let doc=t.createTable(1,2);
  doc=t.editCell(doc,doc.cells[0].id,"• [b]첫째[/b]");doc=t.editCell(doc,doc.cells[1].id,"• [b]둘째[/b]");
  doc.cells[0].format="○ [b]첫째[/b]";doc.cells[1].format="■ [b]둘째[/b]";
  const response=await batch.POST(request({subject:"목록 일괄 저장",cards:[original,{section:"기본",question:"표 질문",answer:t.tableText(doc),answerFormat:t.encodeTable(doc)}]}));
  assert.equal(response.status,201);
  const rows=(await response.json()).cards;
  assert.equal(rows[0].answer,card.answer);assert.deepEqual(rows[0].keywords,card.keywords);
  assert.equal(rows[1].answer,"• 첫째\t• 둘째");
  const reopened=t.readTable(rows[1].answerFormat);
  assert.equal(t.tableText(reopened),rows[1].answer);assert.deepEqual(reopened.cells.map(c=>c.keywordIds),doc.cells.map(c=>c.keywordIds));
});


test("brackets alone lose bold while enclosed text, spacing and other styles survive",async()=>{
  const {normalizeQuestionFormat,normalizeAnswerFormat,extractBoldKeywords}=await vite.ssrLoadModule("/lib/card-data.ts");
  const original="- [b]반사적 듣기 (reactive listening)[/b] :",text=t.plainCell(original);
  const answer=normalizeAnswerFormat(original,text);
  assert.equal(answer,"• [b]반사적 듣기[/b] ([b]reactive listening[/b]) :");
  assert.deepEqual(extractBoldKeywords(answer),["반사적 듣기","reactive listening"]);
  assert.equal(normalizeAnswerFormat(answer,text),answer);
  const styles="[b][u]앞 (안[속]) 뒤[/u][/b] [accent]{강조}[/accent] 일반";
  const normalized=t.normalizeBoldBrackets(styles);
  assert.equal(t.plainCell(normalized),t.plainCell(styles));
  assert.match(normalized,/\[u\]\(\[\/u\]/);
  assert.match(normalized,/\[accent\]강조\[\/accent\]/);
  assert.equal(t.normalizeBoldBrackets(normalized),normalized);
  for(const bracket of [..."()[]{}（）［］｛｝〈〉《》「」『』【】〔〕"]) {
    const result=normalizeQuestionFormat(`[b]가${bracket}나[/b]`,`가${bracket}나`);
    assert.equal(result,`[b]가[/b]${bracket}[b]나[/b]`);
  }
  assert.equal(normalizeQuestionFormat("[b]비교 < 3 > 1[/b]","비교 < 3 > 1"),"[b]비교 < 3 > 1[/b]");
});

test("table bracket normalization preserves geometry and unrelated keyword identities",async()=>{
  const {normalizeAnswerFormat}=await vite.ssrLoadModule("/lib/card-data.ts");
  let doc=t.createTable(1,2);
  doc=t.editCell(doc,doc.cells[1].id,"[b]유지[/b]");
  doc.cells[0].format="[b]반사적 듣기 (reactive listening)[/b]";
  doc.cells[0].keywordIds=[t.tableId()];
  const old=t.encodeTable(doc),text=t.tableText(doc);
  assert.deepEqual(t.readTable(old),doc,"read-only access never reinterprets old IDs");
  const saved=t.readTable(normalizeAnswerFormat(old,text));
  assert.equal(t.tableText(saved),text);
  assert.deepEqual(saved.rows,doc.rows);assert.deepEqual(saved.columns,doc.columns);
  assert.deepEqual(saved.cells[1],doc.cells[1]);
  assert.deepEqual(t.tableKeywords(t.encodeTable(saved)).map(x=>x.keyword),["반사적 듣기","reactive listening","유지"]);
  assert.equal(normalizeAnswerFormat(t.encodeTable(saved),text),t.encodeTable(saved));
});

test("saving bracket emphasis through the card API preserves content and review counters",async()=>{
  const cards=await vite.ssrLoadModule("/app/api/cards/route.ts");
  const api=await vite.ssrLoadModule("/app/api/cards/[id]/route.ts");
  const data={subject:"영어",section:"기능별 언어 지도",subsection:"듣기 지도",contentType:"교과교육론",question:"교실 듣기 유형",answer:"- 반사적 듣기 (reactive listening) :",memo:"유지할 메모",answerFormat:"- [b]반사적 듣기 (reactive listening)[/b] :",keywordsFromBold:true};
  const added=await cards.POST(request(data));assert.equal(added.status,201);
  const id=(await added.json()).card.id;
  db.prepare("UPDATE cards SET correct_count=3, incorrect_count=2 WHERE id=?").run(id);
  const before=db.prepare("SELECT * FROM cards WHERE id=?").get(id);
  const response=await api.PATCH(request(data),{params:Promise.resolve({id:String(id)})});
  assert.equal(response.status,200,await response.text());
  const after=db.prepare("SELECT * FROM cards WHERE id=?").get(id);
  for(const key of ["subject","section","subsection","content_type","question","answer","memo","correct_count","incorrect_count","media"]) assert.equal(after[key],before[key],key);
  assert.equal(after.answer_format,"• [b]반사적 듣기[/b] ([b]reactive listening[/b]) :");
  assert.deepEqual(JSON.parse(after.keywords),["반사적 듣기","reactive listening"]);
});


test("empty-row deletion protects card content, formats, table structure and photos",()=>{
  const empty={id:"empty",type:"card",cardId:null,question:"",questionFormat:"",answer:"",answerFormat:"",memo:"",media:{question:[],answer:[],memo:[]}};
  assert.equal(app.isEmptyBulkRow(empty),true);
  assert.equal(app.isEmptyBulkRow({...empty,question:" \n",answerFormat:"[b][/b]"}),true);
  for(const field of ["question","questionFormat","answer","answerFormat","memo"]){
    assert.equal(app.isEmptyBulkRow({...empty,[field]:"내용"}),false,field);
  }
  assert.equal(app.isEmptyBulkRow({...empty,answerFormat:t.encodeTable(t.createTable(1,1))}),false,"an empty table still has structure");
  for(const field of ["question","answer","memo"]){
    assert.equal(app.isEmptyBulkRow({...empty,media:{...empty.media,[field]:[{id:"00000000-0000-4000-8000-000000000001"}]}}),false,"photo-only content is protected");
  }
  assert.equal(app.isEmptyBulkRow({...empty,answer:"• "}),false,"Backspace edits list markers first");
  assert.equal(app.isEmptyBulkRow({id:"section",type:"divider",level:1,title:""}),true);
  assert.equal(app.isEmptyBulkRow({id:"section",type:"divider",level:1,title:"섹션"}),false);
});

test("legacy list conversion changes only spaced leading markers and preserves table identities",async()=>{
  const {replaceLegacyListBullets:replace,planLegacyListBullets:plan}=await vite.ssrLoadModule("/lib/list-bullet-migration.ts");
  assert.equal(replace("- 첫째\r\n    - [b]둘째[/b]\n단어-단어\n-3\n- 3\n---\n- -\n-\n• 기존"),"• 첫째\r\n    • [b]둘째[/b]\n단어-단어\n-3\n- 3\n---\n- -\n-\n• 기존");
  assert.equal(replace("[u]- [b]내용[/b][/u]"),"[u]• [b]내용[/b][/u]");
  const empty={question:"질문",questionFormat:"",answer:"답",answerFormat:"",memo:""};
  const unsafe={...empty,answer:"- 정답",answerFormat:"[b]- 정답[/b]"};
  assert.match(plan(unsafe).reason,/키워드/);
  let doc=sample();doc=t.editCell(doc,doc.cells[0].id,"- [b]첫째[/b]\n    - [b]둘째[/b]");doc.columnWidthLocks={[doc.columns[0]]:.35};
  const input={...empty,answer:t.tableText(doc),answerFormat:t.encodeTable(doc),memo:"- 메모"};
  const result=plan(input),next=t.readTable(result.next.answerFormat);
  assert.deepEqual(t.tableParts(next).filter(p=>p.type==="blank"),t.tableParts(doc).filter(p=>p.type==="blank"));
  assert.deepEqual(next,{...doc,cells:doc.cells.map(c=>({...c,format:replace(c.format)}))});
  assert.equal(result.next.memo,"• 메모");assert.equal(plan(result.next),null,"repeat is a no-op");
});

test("list migration is owner-scoped, conflict-safe, idempotent and preserves archive and learning data",async()=>{
  const create=await vite.ssrLoadModule("/app/api/cards/route.ts");
  const api=await vite.ssrLoadModule("/app/api/cards/list-bullets/route.ts");
  const made=await(await create.POST(request({subject:"목록 변환",section:"기본",question:"- 질문",questionFormat:"- [b]질문[/b]",answer:"- 정답",answerFormat:"- [b]정답[/b]",memo:"- 메모",keywordsFromBold:true}))).json();
  const id=made.card.id;
  db.prepare("UPDATE cards SET question='- 질문',question_format='- [b]질문[/b]',answer='- 정답',answer_format='- [b]정답[/b]',memo='- 메모' WHERE id=?").run(id);
  db.prepare("UPDATE cards SET correct_count=7, incorrect_count=2, mastery_streak=3, archived_at='2026-10-01', archive_review_stage=2, archive_review_due_at='2026-11-01' WHERE id=?").run(id);
  db.prepare("INSERT INTO keyword_stats (card_id,owner_email,keyword_key,keyword,attempts,correct_count) VALUES (?,?,?,?,?,?)").run(id,headers['oai-authenticated-user-email'],'정답','정답',5,4);
  const read=()=>api.GET(new Request("https://test.invalid/api/cards/list-bullets",{headers}));
  assert.equal((await api.GET(new Request("https://test.invalid/api"))).status,401);
  const initial=await(await read()).json(),item=initial.changes.find(c=>c.id===id);
  assert.ok(item);assert.equal(item.before.ownerEmail,undefined);
  const other=new Request("https://test.invalid/api",{method:"POST",headers:{...headers,'oai-authenticated-user-email':'other@example.invalid'},body:JSON.stringify({items:[item]})});
  assert.deepEqual((await(await api.POST(other)).json()).conflicts,[id]);
  db.prepare("UPDATE cards SET memo='- 변경된 메모' WHERE id=?").run(id);
  assert.deepEqual((await(await api.POST(request({items:[item]}))).json()).conflicts,[id]);
  const fresh=(await(await read()).json()).changes.find(c=>c.id===id);
  const before=db.prepare("SELECT * FROM cards WHERE id=?").get(id),stats=db.prepare("SELECT * FROM keyword_stats WHERE card_id=?").all(id);
  assert.deepEqual((await(await api.POST(request({items:[fresh]}))).json()).changed,[id]);
  const after=db.prepare("SELECT * FROM cards WHERE id=?").get(id);
  for(const key of Object.keys(before))if(!['question','question_format','answer','answer_format','memo','updated_at'].includes(key))assert.deepEqual(after[key],before[key],key);
  assert.equal(after.answer,"• 정답");assert.equal(after.memo,"• 변경된 메모");
  assert.deepEqual(db.prepare("SELECT * FROM keyword_stats WHERE card_id=?").all(id),stats);
  assert.equal((await(await read()).json()).changes.some(c=>c.id===id),false);
  assert.deepEqual((await(await api.POST(request({items:[fresh]}))).json()).conflicts,[id]);
});

test("old bulk autosaves and single edits retain migrated bullets without discarding fresh edits or reopening archived cards",async()=>{
  const create=await vite.ssrLoadModule("/app/api/cards/route.ts");
  const organize=await vite.ssrLoadModule("/app/api/cards/organize/route.ts");
  const single=await vite.ssrLoadModule("/app/api/cards/[id]/route.ts");
  const migrate=await vite.ssrLoadModule("/app/api/cards/list-bullets/route.ts");
  const subject="오래된 목록 자동 저장";
  const original={subject,section:"기본",question:"질문",answer:"- 정답",answerFormat:"- [b]정답[/b]",memo:"메모",keywordsFromBold:true};
  const old={...(await(await create.POST(request(original))).json()).card,answer:original.answer,answerFormat:original.answerFormat};
  // Model a legacy row and an editor snapshot created before normalization.
  db.prepare("UPDATE cards SET answer=?,answer_format=? WHERE id=?").run(old.answer,old.answerFormat,old.id);
  const plan=await(await migrate.GET(new Request("https://test.invalid/api",{headers}))).json();
  await migrate.POST(request({items:[plan.changes.find(card=>card.id===old.id)]}));
  db.prepare("UPDATE cards SET archived_at='2026-10-01', archive_review_stage=2, mastery_streak=3, correct_count=7 WHERE id=?").run(old.id);
  const saved=await organize.POST(request({subject,cards:[old,{question:"새 질문",answer:"새 답",section:"기본"}]}));
  assert.equal(saved.status,200);const result=await saved.json();
  const retained=result.cards.find(card=>card.id===old.id);
  assert.equal(retained.answer,"• 정답");assert.equal(retained.answerFormat,"• [b]정답[/b]");
  assert.equal(retained.archivedAt,"2026-10-01");assert.equal(retained.correctCount,7);assert.equal(retained.masteryStreak,3);
  assert.deepEqual(retained.keywords,old.keywords);assert.equal(result.cards.length,2);
  const edited=await single.PATCH(request({...old,memo:"실제로 추가한 메모"}),{params:Promise.resolve({id:String(old.id)})});
  assert.equal(edited.status,200);const updated=(await edited.json()).card;
  assert.equal(updated.answer,"• 정답");assert.equal(updated.memo,"실제로 추가한 메모");assert.equal(updated.correctCount,7);
  assert.equal(updated.archivedAt,null,"a real content edit still follows the normal archive policy");
});

test("migrated table styles survive old snapshots while new cell text and IDs stay intact",async()=>{
  const {preserveMigratedListBullets:preserve,planLegacyListBullets:plan}=await vite.ssrLoadModule("/lib/list-bullet-migration.ts");
  let table=sample();table=t.editCell(table,table.cells[0].id,"- [b]정답[/b]");
  table.cells[0].format="- [b]정답[/b]"; // Existing data predates edit-time normalization.
  const old={question:"질문",questionFormat:"",answer:t.tableText(table),answerFormat:t.encodeTable(table),memo:""};
  const stored=plan(old).next;
  table=t.editCell(table,table.cells[2].id,"새 설명");
  const incoming={...old,answer:t.tableText(table),answerFormat:t.encodeTable(table)};
  const saved=preserve(stored,incoming),after=t.readTable(saved.answerFormat);
  assert.match(saved.answer,/• 정답/);assert.match(saved.answer,/새 설명/);
  assert.deepEqual(after.cells.map(c=>c.keywordIds),table.cells.map(c=>c.keywordIds));
  assert.deepEqual(preserve(old,incoming),incoming,"unmigrated content keeps its own style");
});

test("list editing plans only consume keys inside bullet lists and keep ordinary navigation",async()=>{
  const {planEditorListKey:plan}=await vite.ssrLoadModule("/lib/editor-lists.ts");
  const apply=(text,result)=>{if(!result)return text;for(const edit of [...result.edits].reverse())text=text.slice(0,edit.start)+edit.text+text.slice(edit.end);return text;};
  assert.equal(apply("-",plan("-",1,1," ")),"• ");
  assert.equal(plan("A-",2,2," "),null,"inline hyphen is text");
  assert.deepEqual(plan("- 기존 카드",7,7,"Tab"),{edits:[],anchor:7,focus:7},"pasted list markers participate in list navigation without rewriting the live text");
  assert.equal(plan("일반 문장",5,5,"Enter"),null);
  const list="• 부모\n• 자식\n• 둘째";
  const selected=plan(list,list.length,5,"Tab");
  assert.equal(apply(list,selected),"• 부모\n    • 자식\n    • 둘째");
  assert.ok(selected.anchor>selected.focus,"backward selection stays backward");
  const nested="• 부모\n    • 자식";
  assert.equal(apply(nested,plan(nested,nested.length,nested.length,"Tab")),nested,"a child cannot skip levels");
  assert.equal(apply(nested,plan(nested,11,11,"Backspace")),"• 부모\n• 자식");
  assert.equal(plan(nested,11,11,"Backspace").focus,7);
  assert.equal(apply("• 부모\n        • ",plan("• 부모\n        • ",15,15,"Enter",true)),"• 부모\n    • ");
  assert.equal(apply("• 부모\n    • ",plan("• 부모\n    • ",11,11,"Enter",true)),"• 부모\n• ");
  assert.equal(apply("• 부모\n• ",plan("• 부모\n• ",7,7,"Enter",true)),"• 부모\n");
  assert.equal(apply("• 항목",plan("• 항목",4,4,"Tab",true)),"항목","outdenting a root item exits the list");
  assert.equal(plan("• 항목",4,4,"Enter"),null,"Enter keeps existing field/cell navigation inside lists");
  assert.equal(apply("• 항목",plan("• 항목",4,4,"Enter",true)),"• 항목\n• ");
  assert.equal(plan("일반 문장",5,5,"Enter",true),null,"Shift+Enter outside lists keeps existing line-break behavior");
});

test("bullet indentation survives save/reopen and list markers are never bold keywords",async()=>{
  const {normalizeAnswerFormat,normalizeQuestionFormat,extractBoldKeywords}=await vite.ssrLoadModule("/lib/card-data.ts");
  const source="[b]• 부모 (내용)\n    • 자식[/b]",plain=t.plainCell(source);
  const format=normalizeAnswerFormat(source,plain);
  assert.equal(t.plainCell(format),plain);
  assert.deepEqual(extractBoldKeywords(format),["부모","내용","자식"]);
  assert.equal(normalizeAnswerFormat(format,plain),format);
  const question=normalizeQuestionFormat(source,plain);
  assert.equal(t.plainCell(question),plain);
  assert.equal(extractBoldKeywords(question).some(word=>word.includes("•")),false);
  const doc=t.createTable(1,1),edited=t.editCell(doc,doc.cells[0].id,source);
  assert.deepEqual(t.tableKeywords(t.encodeTable(edited)).map(x=>x.keyword),["부모","내용","자식"]);
  assert.deepEqual(t.readTable(t.encodeTable(edited)),edited);
  assert.deepEqual(t.editCell(edited,doc.cells[0].id,edited.cells[0].format),edited);
});

test("italic and underline survive normalization without changing keyword text or identities",async()=>{
  const data=await vite.ssrLoadModule('/lib/card-data.ts');
  const format='[i][u][b]• 첫째(설명)\n둘째[/b][/u][/i]';
  const normalized=t.normalizeTableListKeywords(format);
  assert.equal(t.plainCell(normalized),'• 첫째(설명)\n둘째');
  assert.deepEqual(t.cellParts(normalized).filter(part=>part.type==='blank').map(part=>part.keyword),['첫째','설명','둘째']);
  assert.ok(normalized.includes('[i]'));assert.ok(normalized.includes('[u]'));
  assert.equal(t.normalizeTableListKeywords(normalized),normalized,'normalization is stable');
  assert.ok(data.normalizeAnswerFormat(normalized,t.plainCell(normalized)).includes('[i]'));
  assert.ok(data.normalizeQuestionFormat(normalized,t.plainCell(normalized)).includes('[u]'));
  assert.deepEqual(data.extractBoldKeywords('[i]기울임[/i] [u]밑줄[/u] [b][i]키워드[/i][/b]'),['키워드']);
  let doc=t.createTable(1,1);doc=t.editCell(doc,doc.cells[0].id,'[b]키워드[/b]');
  const ids=[...doc.cells[0].keywordIds];
  doc=t.editCell(doc,doc.cells[0].id,'[u][i][b]키워드[/b][/i][/u]');
  assert.deepEqual(doc.cells[0].keywordIds,ids,'decorative styles do not reset learning IDs');
  assert.equal(t.tableText(doc),'키워드');assert.equal(t.readTable(t.encodeTable(doc)).cells[0].format,doc.cells[0].format);
});
