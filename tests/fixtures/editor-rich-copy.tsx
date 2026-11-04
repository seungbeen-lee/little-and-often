import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { FormattedTextEditor, QuestionContent } from "../../app/study-app";
import { TableAnswer } from "../../components/table-card";
import { createTable, editCell } from "../../lib/table-card";
import { emptyMedia } from "../../lib/card-media";
import "../../app/globals.css";
const format="[b]첫 키워드[/b] [u]설명[/u]\n[i]둘째[/i] 항목";
let table=createTable(1,1);table=editCell(table,table.cells[0].id,format);
function Fixture(){
 const [value,setValue]=useState({text:"",format:""});
 return <main style={{padding:20}}><div data-testid="reader" style={{whiteSpace:"pre-wrap"}}><QuestionContent card={{question:"첫 키워드 설명\n둘째 항목",questionFormat:format,media:emptyMedia()}}/></div>
 <div data-testid="reader-table"><TableAnswer doc={table} expandable={false}/></div>
 <FormattedTextEditor {...value} answer label="붙여넣기" placeholder="붙여넣기" onChange={(text,format)=>setValue({text,format})}/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
