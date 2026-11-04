"use client";
import "./table-card.css";

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useEditorLists } from "./use-editor-lists";
import { handleEditorListKey, planEditorListKey } from "../lib/editor-lists";
import { copyCardSelection } from "../lib/editor-clipboard";
import { editorCompositionSettledEvent, isEditorComposing } from "../lib/editor-composition";
import { focusTableEditorAtEnd, releaseTableEditorFocus } from "../lib/editor-focus";
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Bold, ImagePlus, Loader2, Table2, Undo2, Redo2, MousePointer2, Rows3, Columns3, Merge, Split, PaintBucket, HelpCircle, Plus, Minus, LockKeyhole, UnlockKeyhole, Equal } from "lucide-react";
import { useVisibleViewport } from "./use-visible-viewport";
import { blurEditorPreservingTyping, clearManualEditorBold, hasManualEditorBold, toggleCaretBold, usePlainEditorTyping } from "./use-plain-editor-typing";
import { tableCellAlignment, cycleTableAlignment, BOLD_BRACKET_PATTERN, equalizeTableColumnWidths, normalizeTableListKeywords, splitBoldLists, tableColumnWidths, tableEditorColumnRatios } from "../lib/table-card";
import { Button } from "./ui/button";
import { TableTemplates } from "./table-templates";
import { desktopEditorSelection, selectEditorItems, tableSelectionRange, type EditorSelectionMode } from "../lib/editor-selection";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { createTable, editCell, encodeTable, mergeCells, plainCell, readTable, removeEmptyTableAxis, removeSelectedTableAxis, resizeTable, resizeTableColumnBoundary, selectedTableColumns, sortedCells, tableColumnTracks, tableEditorMove, tableEditorShortcut, tableText, tableViewerMobileFontSize, toggleTableColumnWidthLocks, unmergeCells, type TableCell, type TableDocument } from "../lib/table-card";

export function TableGrid({ doc, renderCell, selected = [], onSelect, onEdit, editingCellId, multiSelect = false, contentSized = false, onResizeColumns, editorLayout = false, columnRatios }: { doc: TableDocument; renderCell: (cell: TableCell) => ReactNode; selected?: string[]; onSelect?: (cell: TableCell, mode: EditorSelectionMode) => void; onEdit?: (cell: TableCell) => void; editingCellId?: string | null; multiSelect?: boolean; contentSized?: boolean; onResizeColumns?: (next: TableDocument) => void; editorLayout?: boolean; columnRatios?: number[] }) {
  const lastClick = useRef<{id:string;at:number}|null>(null);
  const gridRef = useRef<HTMLSpanElement>(null);
  const [editingLayout,setEditingLayout] = useState<{width:number;textWidths:Record<string,number>}>({width:0,textWidths:{}});
  const [columnWidths,setColumnWidths]=useState<number[]>([]);
  const [resizePreview,setResizePreview]=useState<{doc:TableDocument;resizable:boolean;widths:number[]|null}|null>(null);
  const drag=useRef<{boundary:number;x:number;widths:number[];next:TableDocument}|null>(null);
  const editing = !!onSelect;
  const measureEditorLayout=editing||editorLayout;
  const resizable=!!onResizeColumns&&editing&&!contentSized;
  // A preview belongs to its source document; undo/new props invalidate it
  // immediately without an extra effect-driven state update.
  const resizeWidths=resizePreview?.doc===doc&&resizePreview.resizable===resizable?resizePreview.widths:null;
  const setResizeWidths=useCallback((widths:number[]|null)=>setResizePreview({doc,resizable,widths}),[doc,resizable]);
  useLayoutEffect(()=>{
    if(!resizable||!gridRef.current)return;
    const widths=getComputedStyle(gridRef.current).gridTemplateColumns.split(/\s+/).map(parseFloat);
    if(widths.length===doc.columns.length&&widths.every(width=>Number.isFinite(width)&&width>0))setColumnWidths(widths);
  },[resizable,doc,editingLayout]);
  useEffect(()=>{
    // Document changes (including undo) or a responsive mode change cancel any
    // unfinished gesture; dragging itself never applies or records intermediate widths.
    drag.current=null;
  },[doc,resizable]);
  useEffect(()=>{
    if(!resizeWidths)return;
    const cancel=(event:KeyboardEvent)=>{
      if(event.key!=="Escape"||!drag.current)return;
      event.preventDefault();event.stopImmediatePropagation();drag.current=null;setResizeWidths(null);
    };
    window.addEventListener("keydown",cancel,true);
    return ()=>window.removeEventListener("keydown",cancel,true);
  },[resizeWidths,setResizeWidths]);
  useLayoutEffect(() => {
    const grid=gridRef.current;
    if (!grid || !measureEditorLayout || contentSized) return;
    let frame=0,active=true,lastWidth=-1;
    const canvas=document.createElement("canvas"),context=canvas.getContext("2d");
    const measure=()=>{
      if(!active)return;
      const textWidths:Record<string,number>={};
      if(context) for(const cell of doc.cells){
        const editor=grid.querySelector<HTMLElement>(`[data-table-editor="${cell.id}"]`)??grid.querySelector<HTMLElement>(`[data-table-cell-id="${cell.id}"] .answer-table-cell-content`);
        if(!editor)continue;
        const style=getComputedStyle(editor);
        // Use the displayed font and a conservative bold width so labels do
        // not wrap when keyword emphasis is added. This does not edit the doc.
        context.font=`750 ${style.fontSize} ${style.fontFamily}`;
        textWidths[cell.id]=Math.max(0,...plainCell(cell.format).split("\n").map(line=>context.measureText(line).width));
      }
      setEditingLayout({width:Math.max(0,grid.clientWidth-2),textWidths});
    };
    measure();
    const observer=new ResizeObserver(entries=>{
      const width=entries[0]?.contentRect.width??0;
      if(Math.abs(width-lastWidth)<.5)return;
      lastWidth=width;cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);
    });
    observer.observe(grid);
    void document.fonts.ready.then(()=>{if(active){cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);}});
    return ()=>{active=false;cancelAnimationFrame(frame);observer.disconnect();};
  },[measureEditorLayout,contentSized,doc]);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    // Wrapped content must set the minimum block size even for row-spanning
    // cells. Do not let intrinsic grid sizing place the next row over the text.
    // offsetHeight is untransformed, including in the rotated table viewer.
    const contents = Array.from(grid.querySelectorAll<HTMLElement>(".answer-table-cell-content"));
    const measure = () => {
      const sizes = contents.map((content) => {
        const cell = content.parentElement!;
        const style = getComputedStyle(cell);
        const height = Math.ceil(Math.max(content.offsetHeight, content.scrollHeight)
          + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
          + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth));
        return {cell, height: Math.max(32, height)};
      });
      for (const {cell, height} of sizes) {
        const value = `${height}px`;
        if (cell.style.getPropertyValue("--table-cell-min-height") !== value) {
          cell.style.setProperty("--table-cell-min-height", value);
        }
      }
    };
    measure();
    let frame=0;
    const observer = new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);});
    contents.forEach((content) => observer.observe(content));
    // Insets can change at a responsive breakpoint without changing line count.
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [doc]);
  return <span onCopy={!editing ? event=>copyCardSelection(event,event.currentTarget) : undefined} className="answer-table-scroll" role="region" aria-label="표 답안" tabIndex={0}>
    <span ref={gridRef} className={`answer-table${contentSized ? " is-content-sized" : ""}${columnRatios ? " is-proportional" : ""}${resizable ? " is-column-resizable" : ""}${resizeWidths ? " is-column-resizing" : ""}`} role="table" style={{ gridTemplateColumns: resizeWidths ? resizeWidths.map(width=>`${width}px`).join(" ") : columnRatios ? columnRatios.map(ratio=>`minmax(0, ${ratio*100}%)`).join(" ") : contentSized ? `repeat(${doc.columns.length}, max-content)` : tableColumnTracks(doc,measureEditorLayout,{},editingLayout.width,editingLayout.textWidths) }}>
      {sortedCells(doc).map((cell) => <span key={cell.id} role="cell" data-table-cell-id={cell.id} aria-label={`${doc.rows.indexOf(cell.row)+1}행 ${doc.columns.indexOf(cell.column)+1}열`}
        className={`answer-table-cell shade-${cell.shade}${selected.includes(cell.id) ? " is-selected" : ""}`}
        style={{ gridColumn: `${doc.columns.indexOf(cell.column)+1} / span ${cell.colSpan}`, gridRow: `${doc.rows.indexOf(cell.row)+1} / span ${cell.rowSpan}`, borderWidth:1, textAlign:cell.textAlign }}
        data-cell-editing={onEdit ? editingCellId===cell.id : undefined} data-column-width-locked={editing&&doc.columns.slice(doc.columns.indexOf(cell.column),doc.columns.indexOf(cell.column)+cell.colSpan).every(id=>doc.columnWidthLocks?.[id])||undefined} tabIndex={onEdit ? (selected.includes(cell.id)?0:-1) : undefined}
        onMouseDown={onSelect ? (event)=>{if(editingCellId!==cell.id||event.shiftKey||event.ctrlKey||event.metaKey)event.preventDefault();} : undefined}
        onClick={onSelect ? (event) => {
          const extend=multiSelect||event.shiftKey||event.ctrlKey||event.metaKey;
          if(editingCellId===cell.id&&!extend)return;
          const now=performance.now(),again=lastClick.current?.id===cell.id&&now-lastClick.current.at<400;
          lastClick.current=extend?null:{id:cell.id,at:now};
          if(onEdit&&!extend&&(again||event.detail>1)){lastClick.current=null;onEdit(cell);return;}
          const mode = desktopEditorSelection() && event.shiftKey ? "range" : extend ? "toggle" : "single";
          onSelect(cell,mode);event.currentTarget.focus({preventScroll:true});
        } : undefined}
        onKeyDown={onEdit ? (event)=>{if(event.target===event.currentTarget&&(event.key==="Enter"||event.key==="F2")&&!event.nativeEvent.isComposing){event.preventDefault();onEdit(cell);}} : undefined}><span className="answer-table-cell-content">{renderCell(cell)}</span></span>)}
      {resizable&&columnWidths.length===doc.columns.length&&<span className="table-column-resize-layer" role="presentation">
        {resizeWidths&&<button type="button" hidden tabIndex={-1} data-photo-back="111.5" onClick={()=>{drag.current=null;setResizeWidths(null);}}/>}
        {columnWidths.slice(0,-1).map((_,boundary)=>{
          const widths=resizeWidths??columnWidths,total=widths.reduce((sum,width)=>sum+width,0);
          return <span key={doc.columns[boundary]} className="table-column-resize-handle" role="separator" aria-orientation="vertical" aria-label={`${boundary+1}열과 ${boundary+2}열 너비 조절`} title="드래그하여 열 너비 조절" style={{left:`${100*widths.slice(0,boundary+1).reduce((sum,width)=>sum+width,0)/total}%`}}
            onClick={event=>event.stopPropagation()}
            onPointerDown={event=>{
              if(event.button!==0||!desktopEditorSelection()||!gridRef.current)return;
              event.preventDefault();event.stopPropagation();
              const measured=getComputedStyle(gridRef.current).gridTemplateColumns.split(/\s+/).map(parseFloat);
              if(measured.length!==doc.columns.length||measured.some(width=>!Number.isFinite(width)||width<=0))return;
              drag.current={boundary,x:event.clientX,widths:measured,next:doc};setResizeWidths(measured);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event=>{
              const current=drag.current;if(!current||current.boundary!==boundary)return;
              event.preventDefault();
              const next=resizeTableColumnBoundary(doc,boundary,event.clientX-current.x,current.widths);
              current.next=next;
              const total=current.widths.reduce((sum,width)=>sum+width,0);
              setResizeWidths(current.widths.map((width,index)=>next!==doc&&(index===boundary||index===boundary+1)?next.columnWidthLocks![doc.columns[index]]*total:width));
            }}
            onPointerUp={event=>{
              const current=drag.current;if(!current)return;
              event.stopPropagation();drag.current=null;setResizeWidths(null);
              if(current.next!==doc)onResizeColumns?.(current.next);
            }}
            onPointerCancel={()=>{drag.current=null;setResizeWidths(null);}}
            onLostPointerCapture={()=>{drag.current=null;setResizeWidths(null);}}/>;
        })}
      </span>}
    </span>
  </span>;
}

export function TableAnswer({ doc, expandable = true, buttonOnly = false }: { doc: TableDocument; expandable?: boolean; buttonOnly?: boolean }) {
  const [open,setOpen] = useState(false);
  const [dialogSize,setDialogSize] = useState<{ width: number; height: number } | null>(null);
  const viewport = useVisibleViewport();
  const mobileViewer = viewport.width < 760 || (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);
  const rotated = mobileViewer && viewport.width < viewport.height;
  const [viewerBody,setViewerBody] = useState<HTMLDivElement | null>(null);
  const sourceRef=useRef<HTMLSpanElement>(null);
  const [viewerLayout,setViewerLayout]=useState<{ratios:number[];naturalWidth:number}|null>(null);
  const measureViewerLayout=useCallback(()=>{
    const source=sourceRef.current?.querySelector<HTMLElement>(".table-fit-stage .answer-table");
    // Button-only library tiles do not mount a hidden copy of a potentially
    // large table. Resolve the same editor layout on demand instead.
    const editorSource=source?.closest(".table-editor-dialog")?source:null;
    const referenceWidth=editorSource?editorSource.clientWidth-2:Math.max(160,viewport.width<760?viewport.width*.98-26:Math.min(1200,viewport.width*.96)-60);
    const style=getComputedStyle(source??sourceRef.current??document.body);
    const context=document.createElement("canvas").getContext("2d"),textWidths:Record<string,number>={};
    if(context){
      const fontSize=source?style.fontSize:`${parseFloat(getComputedStyle(document.documentElement).fontSize)*.875}px`;
      context.font=`750 ${fontSize} ${style.fontFamily}`;
      for(const cell of doc.cells)textWidths[cell.id]=Math.max(0,...plainCell(cell.format).split("\n").map(line=>context.measureText(line).width));
    }
    const measured=editorSource?getComputedStyle(editorSource).gridTemplateColumns.split(/\s+/).map(parseFloat):[];
    const total=measured.reduce((sum,width)=>sum+width,0);
    const ratios=measured.length===doc.columns.length&&measured.every(width=>Number.isFinite(width)&&width>0)
      ?measured.map(width=>width/total):tableEditorColumnRatios(doc,referenceWidth,context?textWidths:undefined);
    const natural=tableColumnWidths(doc,false,context?textWidths:{});
    const naturalWidth=Math.max(160,...natural.map((width,index)=>width/Math.max(.000001,ratios[index])));
    setViewerLayout(current=>current&&Math.abs(current.naturalWidth-naturalWidth)<.1&&current.ratios.every((ratio,index)=>Math.abs(ratio-ratios[index])<.000001)?current:{ratios,naturalWidth});
  },[doc,viewport.width]);
  const openViewer=()=>{measureViewerLayout();setOpen(true);};
  useLayoutEffect(()=>{if(open)measureViewerLayout();},[open,measureViewerLayout]);
  useLayoutEffect(() => {
    const body = viewerBody;
    if (!open || !body || !viewerLayout) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const table = body.querySelector<HTMLElement>(".answer-table.is-content-sized");
        if (!table || !body.clientWidth || !body.clientHeight) return;
        const availableWidth=mobileViewer?(rotated?viewport.height:viewport.width)-4:viewport.width-84;
        // Keep column percentages fixed, fitting the table as a whole. When
        // there is room, retain explicit line breaks without extra wrapping.
        body.style.setProperty("--table-viewer-width",`${Math.max(1,Math.min(availableWidth,viewerLayout.naturalWidth*16.5/14))}px`);
        body.style.removeProperty("--table-viewer-font-size");
        const baseSize = Number.parseFloat(getComputedStyle(table).fontSize);
        const size = mobileViewer
          ? tableViewerMobileFontSize(table.scrollWidth, table.scrollHeight, body.clientWidth, body.clientHeight, baseSize)
          : 16.5;
        body.style.setProperty("--table-viewer-font-size", `${size}px`);
        if (mobileViewer) {
          let adjusted = size;
          const nearFit = table.scrollWidth <= body.clientWidth * 1.18 && table.scrollHeight <= body.clientHeight * 1.18;
          while (nearFit && adjusted > 12.5 && (table.scrollWidth > body.clientWidth || table.scrollHeight > body.clientHeight)) {
            adjusted = Math.max(12.5, adjusted - 0.1);
            body.style.setProperty("--table-viewer-font-size", `${adjusted}px`);
          }
          setDialogSize(null);
          return;
        }
        let desktopSize = size;
        const frameGap = 32;
        const frameAllowance = 4;
        const fitWidth = viewport.width - 16 - frameGap * 2 - frameAllowance;
        const fitHeight = viewport.height - 16 - frameGap * 2 - frameAllowance;
        while (desktopSize > 13.5 && (table.scrollWidth > fitWidth || table.scrollHeight > fitHeight)) {
          desktopSize = Math.max(13.5, Math.round((desktopSize - 0.2) * 10) / 10);
          body.style.setProperty("--table-viewer-font-size", `${desktopSize}px`);
        }
        const next = {
          width: Math.min(viewport.width - 16, Math.max(180, table.scrollWidth + frameGap * 2 + frameAllowance)),
          height: Math.min(viewport.height - 16, Math.max(52, table.scrollHeight + frameGap * 2 + frameAllowance)),
        };
        setDialogSize((current) => current?.width === next.width && current.height === next.height ? current : next);
      });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(body);
    const table = body.querySelector<HTMLElement>(".answer-table.is-content-sized");
    if (table) observer.observe(table);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); body.style.removeProperty("--table-viewer-font-size");body.style.removeProperty("--table-viewer-width"); };
  }, [open, rotated, mobileViewer, viewport.width, viewport.height, doc, viewerBody, viewerLayout]);
  useEffect(() => {
    const body = viewerBody;
    if (!open || !rotated || !body) return;
    // CSS rotation does not rotate the browser/modal scroll-lock gesture axes.
    // Translate the physical drag into this scroller's logical axes ourselves.
    let touch: { x: number; y: number } | null = null;
    const start = (event: TouchEvent) => { touch = event.touches.length === 1 ? {x:event.touches[0].clientX,y:event.touches[0].clientY} : null; };
    const move = (event: TouchEvent) => {
      if (!touch || event.touches.length !== 1) { touch=null; return; }
      const point=event.touches[0];
      body.scrollTop += point.clientX-touch.x;
      body.scrollLeft -= point.clientY-touch.y;
      touch={x:point.clientX,y:point.clientY};
      if(event.cancelable)event.preventDefault();
    };
    const end = () => { touch=null; };
    const wheel = (event: WheelEvent) => { if(event.ctrlKey)return;body.scrollTop += Math.abs(event.deltaX)>Math.abs(event.deltaY) ? -event.deltaX : event.deltaY;if(event.cancelable)event.preventDefault(); };
    body.addEventListener("touchstart",start,{passive:true});
    body.addEventListener("touchmove",move,{passive:false});
    body.addEventListener("touchend",end);body.addEventListener("touchcancel",end);
    body.addEventListener("wheel",wheel,{passive:false});
    return () => {body.removeEventListener("touchstart",start);body.removeEventListener("touchmove",move);body.removeEventListener("touchend",end);body.removeEventListener("touchcancel",end);body.removeEventListener("wheel",wheel);};
  },[open,rotated,viewerBody]);
  const grid = (contentSized = false) => <TableGrid doc={doc} contentSized={contentSized} editorLayout columnRatios={contentSized?viewerLayout?.ratios:undefined} renderCell={(cell) => <span dangerouslySetInnerHTML={{__html:cellHtml(splitBoldLists(cell.format)).replaceAll("<strong>", '<strong class="answer-keyword">')}}/>} />;
  if (!expandable) return grid();
  return <span ref={sourceRef} data-table-interaction="true" onClick={(event)=>event.stopPropagation()} onKeyDown={(event)=>event.stopPropagation()}>
    {buttonOnly ? <button type="button" className="table-preview-open" onClick={openViewer}><Table2 aria-hidden="true" />표 확인하기</button> :
      <span className="table-fit-preview" role="button" tabIndex={0} aria-label="표 크게 보기" title="클릭해서 표 크게 보기" onClick={openViewer} onKeyDown={(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();openViewer();}}}>
        <span className="table-fit-stage" inert>{grid()}</span>
      </span>}
    <Dialog open={open} onOpenChange={(value)=>{setOpen(value);if(!value)setDialogSize(null);}}><DialogContent className={`table-viewer-dialog${rotated?" is-landscape":""}${mobileViewer?" is-mobile":""}${!mobileViewer&&!dialogSize?" is-sizing":""}`} style={viewport.width ? {left:viewport.left+viewport.width/2,top:viewport.top+viewport.height/2,width:mobileViewer?(rotated?viewport.height:viewport.width):dialogSize?.width??viewport.width-16,height:mobileViewer?(rotated?viewport.width:viewport.height):dialogSize?.height??viewport.height-16,translate:"none",transform:`translate(-50%, -50%)${rotated?" rotate(90deg)":""}`} : undefined} overlayClassName="table-viewer-overlay" onEscapeKeyDown={(event)=>event.stopPropagation()}>
      <button type="button" hidden tabIndex={-1} data-photo-back="151" onClick={()=>{setOpen(false);setDialogSize(null);}}/>
      <DialogHeader className="sr-only"><DialogTitle>표 크게 보기</DialogTitle><DialogDescription>표 내용 전체 보기</DialogDescription></DialogHeader>
      <div className="table-viewer-body" ref={setViewerBody}>{grid(true)}</div>
    </DialogContent></Dialog>
  </span>;
}

function fromDom(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  if (node.tagName === "BR") return "\n";
  let inner = contentFormat(node);
  if (node.tagName === "B" || node.tagName === "STRONG" || node.style.fontWeight === "bold" || Number(node.style.fontWeight) >= 600) inner = `[b]${inner}[/b]`;
  if (node.tagName === "U" || node.style.textDecoration.includes("underline")) inner = `[u]${inner}[/u]`;
  if (node.tagName === "I" || node.tagName === "EM" || node.style.fontStyle === "italic") inner = `[i]${inner}[/i]`;
  return inner;
}
function contentFormat(node: Node): string {
  let output="";
  for (const child of Array.from(node.childNodes)) {
    const block=child instanceof HTMLElement && /^(DIV|P|LI)$/u.test(child.tagName);
    if(block && output && !output.endsWith("\n")) output+="\n";
    output+=fromDom(child);
    if(block && child.nextSibling && !output.endsWith("\n")) output+="\n";
  }
  return output;
}
function cellHtml(format: string) {
  return format.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll("[b]","<strong>").replaceAll("[/b]","</strong>").replaceAll("[accent]","<strong>").replaceAll("[/accent]","</strong>").replaceAll("[u]","<u>").replaceAll("[/u]","</u>").replaceAll("[i]","<em>").replaceAll("[/i]","</em>").replaceAll("\n","<br>");
}
const caretAtEnd = focusTableEditorAtEnd;

function cellSelectionOffsets(editor: HTMLElement) {
  const selection=window.getSelection();
  if(!selection?.anchorNode||!selection.focusNode||!editor.contains(selection.anchorNode)||!editor.contains(selection.focusNode))return null;
  const offset=(node:Node,at:number)=>{
    const path:number[]=[];
    for(let current=node;current!==editor;current=current.parentNode!)path.unshift(Array.prototype.indexOf.call(current.parentNode!.childNodes,current));
    const clone=editor.cloneNode(true);let target=clone;
    for(const index of path)target=target.childNodes[index];
    const range=document.createRange();range.setStart(target,at);range.collapse(true);range.insertNode(document.createTextNode("\uFDD0"));
    return plainCell(contentFormat(clone)).indexOf("\uFDD0");
  };
  return {anchor:offset(selection.anchorNode,selection.anchorOffset),focus:offset(selection.focusNode,selection.focusOffset)};
}

function restoreCellSelection(editor:HTMLElement,offsets:{anchor:number;focus:number}) {
  const position=(offset:number):[Node,number]=>{
    const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);let remaining=Math.max(0,offset);
    while(walker.nextNode()){
      const node=walker.currentNode;
      if(node.nodeType===Node.TEXT_NODE){const length=node.textContent?.length??0;if(remaining<=length)return[node,remaining];remaining-=length;}
      else if(node.nodeName==="BR"){const index=Array.prototype.indexOf.call(node.parentNode!.childNodes,node);if(remaining<=1)return[node.parentNode!,index+remaining];remaining--;}
    }
    return [editor,editor.childNodes.length];
  };
  const [anchor,anchorOffset]=position(offsets.anchor),[focus,focusOffset]=position(offsets.focus);
  window.getSelection()?.setBaseAndExtent(anchor,anchorOffset,focus,focusOffset);
}

function toggleTableTextBold(editor:HTMLElement) {
  const selection=window.getSelection();
  if(!selection?.rangeCount||selection.isCollapsed)return;
  const range=selection.getRangeAt(0),offsets=cellSelectionOffsets(editor);
  const format=splitBoldLists(normalizeTableListKeywords(contentFormat(range.cloneContents())));
  const plainRemainder=plainCell(format.replace(/\[b\][\s\S]*?\[\/b\]/g," "))
    .replace(/^[^\S\r\n]*(?:-|\d+\.(?=\s|$))[^\S\r\n]*/gm,"").replace(/[\s,，、:：;；·•]/g,"").replace(BOLD_BRACKET_PATTERN, "");
  const clear=format.includes("[b]")&&!plainRemainder;
  const runs:Range[]=[];
  if(clear){
    const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode;if(!range.intersectsNode(node)||!node.parentElement)continue;
      const start=node===range.startContainer?range.startOffset:0,end=node===range.endContainer?range.endOffset:node.textContent?.length??0;
      if(start>=end||parseFloat(getComputedStyle(node.parentElement).fontWeight)<600)continue;
      const run=document.createRange();run.setStart(node,start);run.setEnd(node,end);runs.push(run);
    }
  }
  // Plain list markers/commas make the browser report a mixed selection, even
  // when every keyword is bold. Remove bold only from its actual text runs;
  // keep underline and the unstyled separators, and emit one history edit.
  const suppress=(event:Event)=>event.stopImmediatePropagation();
  editor.addEventListener("input",suppress,true);clearManualEditorBold(editor);
  try{
    if(clear&&runs.length){
      for(const run of runs.reverse()){
        selection.removeAllRanges();selection.addRange(run);
        if(document.queryCommandState("bold"))document.execCommand("bold");
      }
    }else document.execCommand("bold");
  }finally{
    editor.removeEventListener("input",suppress,true);
    if(offsets)restoreCellSelection(editor,offsets);
  }
}

export function keepTableCaretVisible(scroller: HTMLElement) {
  const editor=document.activeElement;
  if(!(editor instanceof HTMLElement)||!editor.matches('[data-table-editor][contenteditable="true"]')||!scroller.contains(editor))return;
  const selection=window.getSelection();
  let caret=editor.getBoundingClientRect();
  if(selection?.rangeCount && selection.focusNode && editor.contains(selection.focusNode)) {
    const range=document.createRange();range.setStart(selection.focusNode,selection.focusOffset);range.collapse(true);
    const rect=range.getClientRects()[0];
    if(rect?.height)caret=rect;
    else if(selection.focusNode.nodeType===Node.TEXT_NODE && selection.focusOffset>0){
      range.setStart(selection.focusNode,selection.focusOffset-1);range.setEnd(selection.focusNode,selection.focusOffset);
      const last=range.getClientRects()[0];if(last?.height)caret=last;
    }
  }
  const frame=scroller.getBoundingClientRect(),visual=window.visualViewport;
  const top=Math.max(frame.top,visual?.offsetTop??0)+12;
  const bottom=Math.min(frame.bottom,(visual?.offsetTop??0)+(visual?.height??window.innerHeight))-12;
  if(caret.bottom>bottom)scroller.scrollTop+=caret.bottom-bottom;
  else if(caret.top<top)scroller.scrollTop+=caret.top-top;
}
export function CellEditor({ cell, editing, onChange, onNavigate, onDelete }: { cell: TableCell; editing:boolean; onChange:(format:string)=>void; onNavigate:(key:string,reverse:boolean)=>boolean; onDelete:()=>boolean }) {
  const ref=useRef<HTMLDivElement>(null);
  // Keep composition listeners on the old cell through blur and its final input.
  usePlainEditorTyping(ref);
  useEditorLists(ref, editing);
  const emitted=useRef<string|null>(null);
  const pendingNavigation=useRef<{key:string;reverse:boolean;anchorTail:number;focusTail:number}|null>(null);
  const [compositionRevision,setCompositionRevision]=useState(0);
  useLayoutEffect(()=>{
    // A tap into another cell supersedes a pending composition-time Tab.
    if(!editing)pendingNavigation.current=null;
    const editor=ref.current;if(!editor||isEditorComposing(editor))return;
    if(document.activeElement!==editor||emitted.current!==cell.format){
      const html=cellHtml(cell.format);
      if(editor.innerHTML!==html){
        // Canonical keyword formatting can replace the DOM (commas, list
        // markers and line breaks). Preserve both ends, including backward
        // selections, instead of treating this refresh as entering a new cell.
        const offsets=document.activeElement===editor?cellSelectionOffsets(editor):null;
        const scroll:{element:HTMLElement;top:number;left:number}[]=[];
        for(let element:HTMLElement|null=editor;element;element=element.parentElement)scroll.push({element,top:element.scrollTop,left:element.scrollLeft});
        const x=window.scrollX,y=window.scrollY;
        editor.innerHTML=html;
        if(offsets)restoreCellSelection(editor,offsets);
        for(const saved of scroll){saved.element.scrollTop=saved.top;saved.element.scrollLeft=saved.left;}
        if(window.scrollX!==x||window.scrollY!==y)window.scrollTo(x,y);
      }
    }
    emitted.current=cell.format;
  },[cell.format,compositionRevision,editing]);
  const emit=(refreshKeywords=false)=>{if(ref.current && !isEditorComposing(ref.current)) {const value=contentFormat(ref.current);
    // A save echo must not replace native text nodes/marked ranges while typing.
    // Explicit formatting still refreshes keyword boundaries immediately.
    emitted.current=refreshKeywords&&!hasManualEditorBold(ref.current)?value:splitBoldLists(normalizeTableListKeywords(value));
    onChange(value);}};
  const settled=useEffectEvent(()=>{
    emit();setCompositionRevision(revision=>revision+1);
    const pending=pendingNavigation.current;pendingNavigation.current=null;
    if(pending){
      const editor=ref.current;
      if(editor){
        const text=plainCell(contentFormat(editor)),length=text.length;
        const offsets={anchor:Math.max(0,length-pending.anchorTail),focus:Math.max(0,length-pending.focusTail)};
        // Only an in-cell list indent needs its original caret restored. A real
        // cell move must not reopen and blur the source IME context a second time.
        if(planEditorListKey(text,offsets.anchor,offsets.focus,pending.key,pending.reverse)){
          editor.focus({preventScroll:true});
          restoreCellSelection(editor,offsets);
          if(handleEditorListKey({target:editor,key:pending.key,shiftKey:pending.reverse,ctrlKey:false,metaKey:false,altKey:false,keyCode:9,defaultPrevented:false,preventDefault(){},stopPropagation(){}}))return;
        }
      }
      onNavigate(pending.key,pending.reverse);
    }
  });
  useLayoutEffect(()=>{
    const editor=ref.current;if(!editor)return;
    const finish=()=>settled();
    editor.addEventListener(editorCompositionSettledEvent,finish);
    return ()=>editor.removeEventListener(editorCompositionSettledEvent,finish);
  },[]);
  return <div ref={ref} className="table-cell-editor" contentEditable={editing} tabIndex={-1} suppressContentEditableWarning role="textbox" aria-readonly={!editing} aria-label="칸 내용" aria-multiline="true" data-table-editor={cell.id} data-editor-lists="true" autoCorrect="off" autoCapitalize="off" spellCheck={false}
    onInput={()=>emit()} onBlur={()=>{emit();setCompositionRevision(revision=>revision+1);}} onKeyDown={(event)=>{
      if(isEditorComposing(ref.current)||event.nativeEvent.isComposing||event.keyCode===229){
        event.stopPropagation();
        if(event.key==="Tab"&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
          event.preventDefault();
          if(!event.repeat&&ref.current){
            const length=plainCell(contentFormat(ref.current)).length,offsets=cellSelectionOffsets(ref.current);
            pendingNavigation.current={key:event.key,reverse:event.shiftKey,anchorTail:length-(offsets?.anchor??length),focusTail:length-(offsets?.focus??length)};
            blurEditorPreservingTyping(ref.current);
          }
        }
        return;
      }
      if(handleEditorListKey(event))return;
      if(tableEditorShortcut(event)==="bold"){event.preventDefault();event.stopPropagation();if(!toggleCaretBold(ref.current)){
        if(ref.current)toggleTableTextBold(ref.current);
        emit(true);
      }return;}
      if((event.metaKey||event.ctrlKey)&&!event.altKey&&(event.code==="KeyU"||event.code==="KeyI")){
        event.preventDefault();event.stopPropagation();
        document.execCommand(event.code==="KeyU"?"underline":"italic");emit(true);return;
      }
      if(event.key==="Tab" || (event.key==="Enter"&&!event.shiftKey)){event.preventDefault();onNavigate(event.key,event.shiftKey);return;}
      if(event.key==="Backspace" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && !(event.currentTarget.textContent??"").trim()){
        const selection=window.getSelection();
        if(selection?.isCollapsed&&selection.rangeCount){const caret=selection.getRangeAt(0),before=caret.cloneRange();before.selectNodeContents(event.currentTarget);before.setEnd(caret.startContainer,caret.startOffset);if(before.toString().length===(event.currentTarget.textContent??"").length&&onDelete()){event.preventDefault();return;}}
      }
      if(!event.key.startsWith("Arrow") || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)return;
      const selection=window.getSelection(); if(!selection?.isCollapsed || !selection.rangeCount)return;
      const range=selection.getRangeAt(0), before=range.cloneRange();before.selectNodeContents(event.currentTarget);before.setEnd(range.startContainer,range.startOffset);
      const backward=event.key==="ArrowLeft"||event.key==="ArrowUp";
      const boundary=backward ? before.toString().length===0 : before.toString().length===(event.currentTarget.textContent??"").length;
      if(boundary&&onNavigate(event.key,false))event.preventDefault();
    }} />;
}

export function TableRegistration({ format, onChange, disabled=false, iconOnly=false }: { format:string; onChange:(text:string,format:string)=>void; disabled?:boolean; iconOnly?:boolean }) {
  const saved=readTable(format);
  const [open,setOpen]=useState(false);
  const [doc,setDoc]=useState<TableDocument>(()=>createTable());
  const docRef=useRef(doc);
  const replaceDoc=(next:TableDocument)=>{docRef.current=next;setDoc(next);};
  const appliedRef=useRef("");
  const appliedTextRef=useRef("");
  const onChangeRef=useRef(onChange);
  useLayoutEffect(()=>{onChangeRef.current=onChange;},[onChange]);
  const [appliedFormat,setAppliedFormat]=useState("");
  const [composing,setComposing]=useState(false);
  const [closeConfirm,setCloseConfirm]=useState(false);
  const [selected,setSelected]=useState<string[]>([]);
  const selectionAnchor=useRef<string|null>(null);
  useEffect(()=>{if(!open)selectionAnchor.current=null;},[open]);
  const [editingCellId,setEditingCellId]=useState<string|null>(null);
  const [multiSelect,setMultiSelect]=useState(false);
  const [error,setError]=useState("");
  const [preview,setPreview]=useState(false);
  const [helpOpen,setHelpOpen]=useState(false);
  const viewport=useVisibleViewport();
  const [history,setHistory]=useState<TableDocument[]>([]),[future,setFuture]=useState<TableDocument[]>([]);
  const [photo,setPhoto]=useState<string>("");
  const [crop,setCrop]=useState<{x:number;y:number;width:number;height:number}|null>(null);
  const [cropStart,setCropStart]=useState<{x:number;y:number}|null>(null);
  const [busy,setBusy]=useState(false);
  const [confirmed,setConfirmed]=useState(false);
  const [deleteAxis,setDeleteAxis]=useState<"row"|"column"|null>(null);
  const currentFormat=useMemo(()=>{try{return encodeTable(doc);}catch{return "";}},[doc]);
  const pending=currentFormat!==appliedFormat;
  const applyCurrent=useCallback(()=>{
    if(currentFormat&&currentFormat===appliedRef.current)return true;
    if(busy||composing||!tableText(doc)||(!!photo&&!confirmed))return false;
    try{
      if(!currentFormat)throw new Error("표 내용을 확인해 주세요.");
      const text=tableText(doc);
      onChangeRef.current(text,currentFormat);
      appliedRef.current=currentFormat;appliedTextRef.current=text;setAppliedFormat(currentFormat);setError("");
      return true;
    }catch(e){setError(e instanceof Error?e.message:"자동 적용하지 못했어요. 다시 시도해 주세요.");return false;}
  },[currentFormat,doc,busy,composing,photo,confirmed]);
  useEffect(()=>{
    if(!open||!pending||busy||composing||(!!photo&&!confirmed))return;
    const timer=window.setTimeout(applyCurrent,500);
    return ()=>window.clearTimeout(timer);
  },[open,pending,busy,composing,photo,confirmed,applyCurrent]);
  const requestClose=()=>{
    if(busy||composing)return;
    if(applyCurrent()||(!tableText(doc)&&!appliedTextRef.current)){setOpen(false);return;}
    setCloseConfirm(true);
  };
  const imageRef=useRef<HTMLImageElement>(null),fileRef=useRef<HTMLInputElement>(null),rootRef=useRef<HTMLDivElement>(null);
  const lastAddedAxis=useRef<"row"|"column">("row");
  const selectedCell=doc.cells.find((cell)=>selected.includes(cell.id));
  const alignmentCell=sortedCells(doc).find(cell=>selected.includes(cell.id));
  const alignment=alignmentCell?tableCellAlignment(alignmentCell):"left";
  const AlignmentIcon={left:AlignLeft,center:AlignCenter,right:AlignRight,justify:AlignJustify}[alignment];
  const alignmentLabel={left:"왼쪽",center:"가운데",right:"오른쪽",justify:"양쪽"}[alignment];
  const selectedColumns=selectedTableColumns(doc,selected);
  const columnsLocked=selectedColumns.length>0&&selectedColumns.every(id=>doc.columnWidthLocks?.[id]);
  const canUnmerge=selected.length===1 && Boolean(selectedCell && (selectedCell.rowSpan>1 || selectedCell.colSpan>1));
  const focusTarget=useRef<string|null>(null);
  useLayoutEffect(()=>{
    if(!open||!editingCellId||preview||viewport.width>=760)return;
    let frame=0;
    const reveal=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(rootRef.current)keepTableCaretVisible(rootRef.current);});};
    reveal();
    const settled=window.setTimeout(reveal,300);
    document.addEventListener("selectionchange",reveal);
    return ()=>{cancelAnimationFrame(frame);clearTimeout(settled);document.removeEventListener("selectionchange",reveal);};
  },[open,editingCellId,preview,viewport.height,viewport.top,viewport.width,doc]);
  useEffect(()=>{if(focusTarget.current){const target=rootRef.current?.querySelector<HTMLElement>(`[data-table-editor="${focusTarget.current}"]`);if(target)caretAtEnd(target);focusTarget.current=null;}},[doc,preview,editingCellId]);
  const change=(next:TableDocument)=>{const previous=docRef.current;setHistory((old)=>[...old.slice(-49),previous]);setFuture([]);replaceDoc(next);setError("");};
  const changeCell=(id:string,value:string)=>{
    const current=docRef.current,cell=current.cells.find(cell=>cell.id===id);
    const normalized=splitBoldLists(normalizeTableListKeywords(value));
    // Blur and a trailing composition input can report the same content twice.
    if(!cell||normalized===cell.format)return;
    safely(()=>editCell(current,id,value));
  };
  const safely=(fn:()=>TableDocument)=>{try{change(fn());}catch(e){setError(e instanceof Error?e.message:"표를 변경하지 못했어요.");}};
  const undo=()=>{const prior=history.at(-1);if(prior){setFuture((old)=>[docRef.current,...old]);setHistory((old)=>old.slice(0,-1));replaceDoc(prior);}};
  const redo=()=>{const next=future[0];if(next){setHistory((old)=>[...old,docRef.current]);setFuture((old)=>old.slice(1));replaceDoc(next);}};
  const toggleWidths=()=>{
    if(!selectedColumns.length)return;
    const grid=rootRef.current?.querySelector<HTMLElement>('.answer-table');
    if(!grid)return;
    const widths=getComputedStyle(grid).gridTemplateColumns.split(/\s+/).map(parseFloat);
    safely(()=>toggleTableColumnWidthLocks(doc,selected,widths));
  };
  const resizeSelectedColumn=(direction:number)=>{
    const cell=doc.cells.find(cell=>cell.id===selectionAnchor.current&&selected.includes(cell.id))??selectedCell;
    const grid=rootRef.current?.querySelector<HTMLElement>('.answer-table');
    if(!cell||!grid||doc.columns.length<2)return;
    const last=doc.columns.indexOf(cell.column)+cell.colSpan-1;
    // Normally move the selected cell's right boundary. The last column uses
    // its left boundary, so Right still means make the selected column wider.
    const boundary=Math.min(last,doc.columns.length-2),delta=direction*(last===doc.columns.length-1?-8:8);
    const widths=getComputedStyle(grid).gridTemplateColumns.split(/\s+/).map(parseFloat);
    try{const next=resizeTableColumnBoundary(doc,boundary,delta,widths);if(next!==doc)change(next);}catch(e){setError(e instanceof Error?e.message:"열 너비를 조절하지 못했어요.");}
  };
  const endEditing=()=>{
    focusTarget.current=null;
    const active=document.activeElement;
    if(active instanceof HTMLElement&&active.matches("[data-table-editor]")&&rootRef.current?.contains(active))releaseTableEditorFocus(active);
    window.getSelection()?.removeAllRanges();setEditingCellId(null);
    rootRef.current?.querySelector<HTMLElement>(`[data-table-cell-id="${editingCellId}"]`)?.focus({preventScroll:true});
  };
  const select=(cell:TableCell,mode:EditorSelectionMode)=>{
    endEditing();
    const anchor=selectionAnchor.current;
    setSelected(previous=>mode==="range" ? tableSelectionRange(doc,anchor,cell.id) : selectEditorItems([],previous,anchor,cell.id,mode));
    if(mode!=="range"||!anchor)selectionAnchor.current=cell.id;
  };
  const selectAll=()=>{endEditing();selectionAnchor.current=sortedCells(doc)[0]?.id??null;setSelected(doc.cells.map(cell=>cell.id));};
  const startEditing=(cell:TableCell)=>{
    focusTarget.current=null;
    // Commit/blur the old host before React makes it read-only. Clearing its
    // selection first prevents the old marked range entering the new host.
    const active=document.activeElement;
    if(active instanceof HTMLElement&&active.dataset.tableEditor!==cell.id&&active.matches("[data-table-editor]")&&rootRef.current?.contains(active))releaseTableEditorFocus(active);
    selectionAnchor.current=cell.id;
    // Focus in this same user gesture so a second tap also opens the iPhone keyboard.
    flushSync(()=>{setSelected([cell.id]);setEditingCellId(cell.id);});
    const target=rootRef.current?.querySelector<HTMLElement>(`[data-table-editor="${cell.id}"]`);if(target)caretAtEnd(target);
  };
  const back=()=>{
    if(busy)return;
    if(editingCellId){endEditing();return;}
    if(selected.length){
      setSelected([]);selectionAnchor.current=null;
      // Keep keyboard focus inside the modal, but off the now-unselected cell.
      rootRef.current?.closest<HTMLElement>('[role="dialog"]')?.focus({preventScroll:true});
      return;
    }
    requestClose();
  };
  const loadPhoto=(file?:File)=>{
    if(!file)return;
    if(!/^image\/(png|jpeg|webp)$/u.test(file.type)||file.size>8*1024*1024){setError("PNG·JPG·WebP 사진을 8MB 이하로 올려 주세요.");return;}
    const reader=new FileReader();reader.onload=()=>{setPhoto(String(reader.result));setCrop(null);setConfirmed(false);setError("");};reader.readAsDataURL(file);
  };
  const recognize=async()=>{
    if(!photo||busy)return;setBusy(true);setError("");
    try{
      let image=photo;
      if(crop&&imageRef.current&&crop.width>.01&&crop.height>.01){const source=imageRef.current;const canvas=document.createElement("canvas");canvas.width=Math.round(source.naturalWidth*crop.width);canvas.height=Math.round(source.naturalHeight*crop.height);canvas.getContext("2d")!.drawImage(source,source.naturalWidth*crop.x,source.naturalHeight*crop.y,canvas.width,canvas.height,0,0,canvas.width,canvas.height);image=canvas.toDataURL("image/png");}
      const response=await fetch("/api/table-import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image}),signal:AbortSignal.timeout(120000)});
      const result=await response.json();if(!response.ok)throw new Error(result.error||"표를 읽지 못했어요. 수동으로 편집할 수 있어요.");
      change(result.table);setSelected([]);setConfirmed(false);
    }catch(e){setError(e instanceof Error?e.message:"표 인식에 실패했어요. 수동 표 편집은 계속 사용할 수 있어요.");}finally{setBusy(false);}
  };
  const navigate=(cell:TableCell,key:string,reverse:boolean)=>{
    try {
      const current=docRef.current;
      let move=tableEditorMove(current,cell.id,key,reverse);if(!move)return false;
      // Commit native input before disabling the old contenteditable node.
      const active=document.activeElement;
      if(active instanceof HTMLElement&&active.dataset.tableEditor===cell.id)releaseTableEditorFocus(active);
      // Blur can deliver a final native edit. Extend the latest table, not the
      // snapshot from before that edit, when Tab/Enter adds a new row or column.
      const committed=docRef.current;
      if(committed!==current){move=tableEditorMove(committed,cell.id,key,reverse);if(!move)return false;}
      setSelected([move.targetId]);
      setEditingCellId(move.targetId);focusTarget.current=move.targetId;
      if(move.doc!==committed){focusTarget.current=move.targetId;if(move.addedAxis)lastAddedAxis.current=move.addedAxis;change(move.doc);}
      return true;
    }catch(e){setError(e instanceof Error?e.message:"칸을 추가하지 못했어요.");return false;}
  };
  const deleteEmpty=(cell:TableCell)=>{const result=removeEmptyTableAxis(doc,cell.id,lastAddedAxis.current);if(!result)return false;focusTarget.current=result.targetId;setEditingCellId(result.targetId);setSelected([result.targetId]);change(result.doc);return true;};
  const styleCells=(style:Partial<TableCell>)=>change({...doc,cells:doc.cells.map((cell)=>selected.includes(cell.id)?{...cell,...style}:cell)});
  const toggleMerge=()=>{
    try {
      const cells=doc.cells.filter((cell)=>selected.includes(cell.id));
      if(!cells.length)return;
      const next=cells.length===1 ? unmergeCells(doc,selected) : mergeCells(doc,selected);
      const id=sortedCells(next).find((cell)=>selected.includes(cell.id))?.id;
      endEditing();setSelected(id?[id]:[]);change(next);
    }catch(e){setError(e instanceof Error?e.message:"직사각형으로 칸을 선택해 주세요.");}
  };
  const cycleAlignment=()=>{if(selected.length)change(cycleTableAlignment(doc,selected));};
  const toggleShade=()=>{if(selected.length)styleCells({shade:doc.cells.filter((cell)=>selected.includes(cell.id)).every((cell)=>cell.shade!==0)?0:1});};
  const toggleKeywords=()=>{
    const selection=window.getSelection();
    if(selection && !selection.isCollapsed && selection.rangeCount){
      const node=selection.getRangeAt(0).commonAncestorContainer;
      const element=(node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>("[data-table-editor]");
      if(!element || !rootRef.current?.contains(element)){setError("한 칸 안의 문구를 선택하거나 여러 칸을 골라 주세요.");return;}
      toggleTableTextBold(element);
      change(editCell(doc,element.dataset.tableEditor!,contentFormat(element)));return;
    }
    let next=doc;
    if(!desktopEditorSelection()) {
      for(const id of selected){const cell=next.cells.find(item=>item.id===id);if(cell)next=editCell(next,id,cell.keywordIds.length?plainCell(cell.format):`[b]${cell.format}[/b]`);}
      change(next);return;
    }
    const cells=doc.cells.filter(cell=>selected.includes(cell.id)&&plainCell(cell.format).trim());
    const clear=cells.length>0&&cells.every(cell=>cell.keywordIds.length>0&&!plainCell(cell.format.replace(/\[b\][\s\S]*?\[\/b\]/g," ")).replace(/[\s,.:;·•\-\d]/g,"").replace(BOLD_BRACKET_PATTERN, "").length);
    for(const cell of cells)next=editCell(next,cell.id,clear?plainCell(cell.format):`[b]${plainCell(cell.format)}[/b]`);
    change(next);
  };
  return <>
    <Button type="button" tabIndex={-1} variant="ghost" size={iconOnly?"icon-sm":"sm"} disabled={disabled} aria-label={saved?"표 편집":"표로 등록"} title={saved?"표 편집":"표로 등록"} className={`table-register-button${iconOnly?" is-icon-only":""}`} onClick={()=>{const initial=saved??createTable(),encoded=encodeTable(initial);appliedRef.current=encoded;appliedTextRef.current=tableText(initial);setAppliedFormat(encoded);setComposing(false);replaceDoc(initial);setCloseConfirm(false);setHistory([]);setFuture([]);setSelected([]);setEditingCellId(null);setMultiSelect(false);setError("");setPhoto("");setPreview(false);setOpen(true);}}><Table2 />{!iconOnly&&(saved?"표 편집":"표로 등록")}</Button>
    <Dialog open={open} onOpenChange={(value)=>{if(!value)requestClose();}}>
      <DialogContent className="table-editor-dialog" style={viewport.width && viewport.width<760 ? {top:viewport.top+viewport.height/2,height:viewport.height-12,maxHeight:viewport.height-12} : undefined} overlayClassName="table-editor-overlay" onKeyDown={(event)=>{event.stopPropagation();const target=event.target as HTMLElement;if(isEditorComposing(target.closest<HTMLElement>("[data-table-editor]"))||event.nativeEvent.isComposing || event.keyCode===229)return;if(desktopEditorSelection()&&!editingCellId&&!target.closest('input,textarea,[contenteditable="true"]')&&selected.length&&event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&(event.key==="ArrowLeft"||event.key==="ArrowRight")){event.preventDefault();if(!busy&&!preview)resizeSelectedColumn(event.key==="ArrowRight"?1:-1);return;}if(desktopEditorSelection()&&!editingCellId&&(event.metaKey||event.ctrlKey)&&event.code==="KeyA"&&!event.altKey){event.preventDefault();if(!busy&&!preview)selectAll();return;}const action=tableEditorShortcut(event);if(!action)return;event.preventDefault();if(busy||preview||((action==="widthLock"||action==="alignment")&&event.repeat))return;if(action==="undo")undo();else if(action==="redo")redo();else if(action==="merge")toggleMerge();else if(action==="shade")toggleShade();else if(action==="bold")toggleKeywords();else if(action==="widthLock")toggleWidths();else if(action==="alignment")cycleAlignment();}} onEscapeKeyDown={(event)=>{event.preventDefault();event.stopPropagation();if(!event.isComposing&&!event.repeat&&!isEditorComposing(rootRef.current?.querySelector<HTMLElement>('[contenteditable="true"][data-table-editor]')??null))back();}}>
        <button type="button" hidden tabIndex={-1} data-photo-back="111" onClick={back}/>
        <DialogHeader><DialogTitle>{saved?"표 편집":"표로 등록"}</DialogTitle><DialogDescription className="sr-only">표 내용을 편집합니다.</DialogDescription></DialogHeader>
        <div className="table-editor-history">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="표 되돌리기" disabled={!history.length||busy} onClick={undo}><Undo2 /></Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="표 다시 실행" disabled={!future.length||busy} onClick={redo}><Redo2 /></Button>
        </div>
        <div className="table-editor-body" ref={rootRef} onCompositionStartCapture={()=>setComposing(true)} onCompositionEndCapture={()=>setComposing(false)} onDragOver={(event)=>{if(event.dataTransfer.types.includes("Files"))event.preventDefault();}} onDrop={(event)=>{if(event.dataTransfer.files.length){event.preventDefault();event.stopPropagation();loadPhoto(event.dataTransfer.files[0]);}}}>
        <div className="table-editor-toolbar">
          <Button type="button" variant="outline" disabled={busy} onClick={()=>fileRef.current?.click()}><ImagePlus />사진으로 등록</Button>
          <TableTemplates doc={doc} selected={preview?[]:selected} disabled={busy} onOpen={endEditing} onApply={next=>{change(next);setSelected([]);selectionAnchor.current=null;setEditingCellId(null);setPreview(false);setPhoto("");setCrop(null);setConfirmed(false);}} />
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event)=>{loadPhoto(event.target.files?.[0]);event.target.value="";}} />
          <Button type="button" variant="outline" onClick={()=>{endEditing();setPreview(!preview);}}>{preview?"편집으로":"미리보기"}</Button>
          <Button type="button" variant="outline" onClick={()=>setHelpOpen(true)}><HelpCircle />사용법</Button>
        </div>
          {photo&&<section className="table-source"><p>원본과 비교 · 표 부분을 드래그하면 해당 영역만 인식해요.</p><div className="table-crop-surface" onPointerDown={(event)=>{const bounds=event.currentTarget.getBoundingClientRect();const point={x:Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)),y:Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height))};setCropStart(point);event.currentTarget.setPointerCapture(event.pointerId);setCrop(null);}} onPointerMove={(event)=>{if(!cropStart)return;const bounds=event.currentTarget.getBoundingClientRect();const x=Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)),y=Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height));setCrop({x:Math.min(x,cropStart.x),y:Math.min(y,cropStart.y),width:Math.abs(x-cropStart.x),height:Math.abs(y-cropStart.y)});}} onPointerUp={()=>setCropStart(null)} onPointerCancel={()=>setCropStart(null)}><img ref={imageRef} src={photo} alt="가져올 표 원본" draggable={false}/>{crop&&<span className="table-crop-selection" style={{left:`${crop.x*100}%`,top:`${crop.y*100}%`,width:`${crop.width*100}%`,height:`${crop.height*100}%`}}/>}</div><div className="table-source-actions"><Button type="button" disabled={busy} onClick={recognize}>{busy?<><Loader2 className="animate-spin"/>인식 중…</>:"표 인식"}</Button><Button type="button" variant="ghost" onClick={()=>setCrop(null)}>전체 사진 사용</Button><small>선택한 사진을 OpenAI로 전송하며 API 사용료가 발생합니다.</small></div></section>}
          {preview?<TableAnswer doc={doc} expandable={false}/>:<TableGrid doc={doc} selected={selected} onSelect={select} onEdit={startEditing} editingCellId={editingCellId} multiSelect={multiSelect} onResizeColumns={!busy&&desktopEditorSelection()?change:undefined} renderCell={(cell)=><CellEditor cell={cell} editing={editingCellId===cell.id} onChange={(value)=>changeCell(cell.id,value)} onNavigate={(key,reverse)=>navigate(cell,key,reverse)} onDelete={()=>deleteEmpty(cell)}/>} />}
          {photo&&<label className="table-import-confirm"><input type="checkbox" checked={confirmed} onChange={(event)=>setConfirmed(event.target.checked)}/>원본과 내용을 비교했고, 빈칸으로 출제할 굵은 키워드를 확인했어요.</label>}
          {error&&<p role="alert" className="table-error">{error}</p>}
        </div>
        {!preview && <div className="table-edit-dock" role="toolbar" aria-label="표 편집 도구">
          <Button type="button" variant={multiSelect?"default":"ghost"} size="icon" aria-label="다중 선택" title="다중 선택" aria-pressed={multiSelect} disabled={busy} onClick={()=>{endEditing();setMultiSelect(!multiSelect);}}><span className="dock-multi"><MousePointer2/><MousePointer2/></span></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="행 추가" title="행 추가" disabled={busy} onClick={()=>safely(()=>resizeTable(doc,"row",selectedCell?doc.rows.indexOf(selectedCell.row)+selectedCell.rowSpan:doc.rows.length))}><Rows3/><Plus className="dock-badge"/></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="열 추가" title="열 추가" disabled={busy} onClick={()=>safely(()=>resizeTable(doc,"column",selectedCell?doc.columns.indexOf(selectedCell.column)+selectedCell.colSpan:doc.columns.length))}><Columns3/><Plus className="dock-badge"/></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="행 삭제" title="행 삭제" disabled={!selectedCell||busy} onClick={()=>setDeleteAxis("row")}><Rows3/><Minus className="dock-badge"/></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="열 삭제" title="열 삭제" disabled={!selectedCell||busy} onClick={()=>setDeleteAxis("column")}><Columns3/><Minus className="dock-badge"/></Button>
          <Button type="button" variant="ghost" size="icon" aria-label={canUnmerge?"병합 해제":"병합"} title={canUnmerge?"병합 해제":"병합"} disabled={busy||(!canUnmerge&&selected.length<2)} onClick={toggleMerge}>{canUnmerge?<Split/>:<Merge/>}</Button>
          <Button type="button" variant="ghost" size="icon" aria-label="칸 색깔 변경" title="흰색 ↔ 회색" disabled={!selected.length||busy} onClick={toggleShade}><PaintBucket/></Button>
          <Button type="button" variant="ghost" size="icon" aria-label={`글자 정렬 변경 (현재 ${alignmentLabel})`} title={`글자 정렬: ${alignmentLabel} · 왼쪽 → 가운데 → 오른쪽 → 양쪽 (F8)`} data-alignment={alignment} disabled={!selected.length||busy||composing} onMouseDown={event=>event.preventDefault()} onClick={cycleAlignment}><AlignmentIcon/></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="키워드 지정" title="키워드 지정" disabled={!selected.length||busy} onMouseDown={(event)=>event.preventDefault()} onClick={toggleKeywords}><Bold/></Button>
          <Button type="button" variant={columnsLocked?"default":"ghost"} size="icon" aria-label={columnsLocked?"열 너비 고정 해제":"열 너비 고정"} title={`${columnsLocked?"열 너비 고정 해제":"선택한 열의 현재 너비 고정"} (Ctrl/⌘+\\)`} aria-pressed={columnsLocked} disabled={!selectedColumns.length||busy} onMouseDown={event=>event.preventDefault()} onClick={toggleWidths}>{columnsLocked?<UnlockKeyhole/>:<LockKeyhole/>}</Button>
          <Button type="button" variant="ghost" size="icon" aria-label="열 너비 균등하게" title="모든 열을 같은 너비로 맞추기 (잠긴 열 포함)" disabled={doc.columns.length<2||busy} onMouseDown={event=>event.preventDefault()} onClick={()=>{const next=equalizeTableColumnWidths(doc);if(next!==doc)change(next);}}><Columns3/><Equal className="dock-badge"/></Button>
        </div>}
        <DialogFooter><span className="table-auto-apply-status" role="status">{pending?(photo&&!confirmed?"원본 확인 후 자동 적용돼요":!tableText(doc)?"내용을 입력하면 자동 적용돼요":error?"변경 내용을 확인해 주세요":"자동 적용 대기 중…"):"자동 적용됨"}</span>{pending&&error&&<Button type="button" variant="outline" disabled={busy||composing} onClick={applyCurrent}>다시 시도</Button>}<Button type="button" aria-label="표 편집 닫기" disabled={busy||composing} onClick={requestClose}>닫기</Button></DialogFooter>
        <Dialog open={closeConfirm} onOpenChange={setCloseConfirm}>
          <DialogContent className="table-delete-dialog" overlayClassName="table-delete-overlay" onKeyDown={event=>event.stopPropagation()} onEscapeKeyDown={event=>{event.preventDefault();event.stopPropagation();setCloseConfirm(false);}}>
            <button type="button" hidden tabIndex={-1} data-photo-back="114" onClick={()=>setCloseConfirm(false)}/>
            <DialogHeader><DialogTitle>작성한 표를 닫을까요?</DialogTitle><DialogDescription>자동 적용하지 못한 변경 내용은 사라집니다. 이미 적용된 내용은 유지돼요.</DialogDescription></DialogHeader>
            <DialogFooter><Button type="button" variant="outline" onClick={()=>setCloseConfirm(false)}>계속 편집</Button><Button type="button" variant="destructive" onClick={()=>{setCloseConfirm(false);setOpen(false);}}>닫기</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent className="table-help-dialog" overlayClassName="table-delete-overlay" onKeyDown={event=>event.stopPropagation()} onEscapeKeyDown={event=>{event.preventDefault();event.stopPropagation();setHelpOpen(false);}}>
          <button type="button" hidden tabIndex={-1} data-photo-back="112" onClick={()=>setHelpOpen(false)}/>
          <DialogHeader><DialogTitle>표 편집 사용법</DialogTitle><DialogDescription>질문은 표 제목, 답은 표 전체입니다.</DialogDescription></DialogHeader>
          <p>한 번 누르면 칸 선택, 두 번 누르면 글자 편집입니다. 굵게 지정한 문구만 시험에서 빈칸이 됩니다.</p>
          <p>입력을 잠깐 멈추면 표가 자동 적용됩니다. 닫을 때도 마지막 변경을 반영하며, 카드 자체의 저장 방식은 기존 편집 창을 따릅니다.</p>
          <ul className="table-help-list"><li><MousePointer2/>다중 선택: 켠 뒤 여러 칸을 차례로 누르세요.</li><li><Rows3/><Plus/>행 추가 · <Columns3/><Plus/>열 추가: 선택한 칸 아래·오른쪽에 추가합니다.</li><li><Rows3/><Minus/>행 삭제 · <Columns3/><Minus/>열 삭제: 병합된 칸은 포함된 행·열 전체를 삭제합니다.</li><li><Merge/>병합: 직사각형으로 여러 칸을 선택하세요.</li><li><Split/>병합 해제: 병합한 칸 하나를 선택하면 버튼이 바뀝니다.</li><li><PaintBucket/>칸 색깔: 흰색과 회색을 전환합니다.</li><li><Bold/>키워드: 선택한 문구 또는 칸 전체를 굵게 지정·해제합니다.</li><li><Undo2/><Redo2/>되돌리기·다시 실행: 편집 변경을 취소·복원합니다.</li></ul>
          <p>PC: Shift+클릭 사각 범위 선택 · Ctrl/⌘+클릭 개별 추가·해제 · 칸 선택 상태에서 Ctrl/⌘+A 전체 칸 선택</p><p>목록 밖 Tab → · Enter ↓ (목록 안에서도 동일, 끝에서 추가) · Shift+Enter 줄바꿈 · Esc 편집 해제</p><p>줄 맨 앞에서 - 다음 공백을 입력하면 • 목록이 됩니다. 목록 안에서는 Tab 들여쓰기 · Shift+Tab 내어쓰기 · Shift+Enter 다음 항목 · 빈 항목에서 Shift+Enter 한 단계 내어쓰기(최상위는 목록 종료)입니다.</p><p>Ctrl/⌘+B 키워드 · M 병합/해제 · P 칸 색 · Z 되돌리기 · Shift+Z 재실행</p><p>Ctrl/⌘+\ 열 너비 고정/해제 (역슬래시, 한글 키보드의 ₩ 표시)</p>
          <p><AlignLeft className="inline size-4"/> 하단 정렬 버튼 또는 F8: 선택한 칸의 글자 정렬을 왼쪽 → 가운데 → 오른쪽 → 양쪽 순서로 바꿉니다. 여러 칸은 맨 위·왼쪽 칸의 현재 정렬을 기준으로 함께 바뀝니다. 글자 편집 중에도 사용할 수 있고 Ctrl/⌘+Z로 되돌릴 수 있어요. 기능 키가 미디어 키로 설정된 키보드는 Fn+F8을 누르세요.</p>
          <p><LockKeyhole className="inline size-4"/> 칸을 선택한 뒤 열 너비를 고정하면 내용을 추가해도 해당 열의 비율이 유지됩니다. 여러 칸이나 병합 칸은 포함된 열을 함께 고정합니다. 같은 버튼으로 해제할 수 있어요.</p>
          <p>PC 열 너비: 열 사이 경계를 드래그하거나, 칸 선택 상태에서 Shift+←/→로 8px씩 줄이거나 늘립니다. 이웃 열과 공간을 나누며 조절한 두 열은 자동 고정됩니다. 글자 편집 중에는 Shift+방향키로 글자를 선택할 수 있고, Esc로 칸 선택 상태로 돌아옵니다. 드래그 중 Esc는 조절만 취소합니다.</p>
          <p>열 너비 균등하게: 잠긴 열을 포함해 표 전체 열을 같은 너비로 맞추고 유지합니다. 버튼으로만 사용할 수 있고, 되돌리기로 이전 비율을 복원할 수 있어요. 회색 셀은 기본적으로 가로·세로 가운데 정렬됩니다. F8로 가로 정렬을 지정하면 칸 색과 관계없이 유지됩니다.</p>
        </DialogContent></Dialog>
        <Dialog open={!!deleteAxis} onOpenChange={(value)=>{if(!value)setDeleteAxis(null);}}><DialogContent className="table-delete-dialog" overlayClassName="table-delete-overlay"><button type="button" hidden tabIndex={-1} data-photo-back="113" onClick={()=>setDeleteAxis(null)}/><DialogHeader><DialogTitle>{deleteAxis==="row"?"행":"열"} {selectedCell ? (deleteAxis==="row" ? selectedCell.rowSpan : selectedCell.colSpan) : 1}개를 삭제할까요?</DialogTitle><DialogDescription>해당 내용도 함께 없어져요. 표 편집의 되돌리기로 복원할 수 있어요.</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={()=>setDeleteAxis(null)}>취소</Button><Button type="button" variant="destructive" onClick={()=>{if(deleteAxis&&selectedCell)safely(()=>removeSelectedTableAxis(doc,deleteAxis,selectedCell.id));setSelected([]);setDeleteAxis(null);}}>삭제</Button></DialogFooter></DialogContent></Dialog>
      </DialogContent>
    </Dialog>
  </>;
}
