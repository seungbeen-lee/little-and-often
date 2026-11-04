"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutTemplate, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { encodeTable, readTable, type TableDocument } from "../lib/table-card";
import { instantiateTableTemplate, selectedTableTemplate, type TableTemplate } from "../lib/table-template";

export function TableTemplates({ doc, selected, disabled, onOpen, onApply }: {
  doc: TableDocument; selected: string[]; disabled: boolean; onOpen: () => void; onApply: (doc: TableDocument) => void;
}) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<TableTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"load" | "save">("load");
  const [draft, setDraft] = useState<TableDocument | null>(null);
  const canSave = selected.length > 1;
  const [reload, setReload] = useState(0);
  const submission = useRef<{ id: string; name: string; format: string } | null>(null);

  useEffect(() => {
    if (!open || mode !== "load") return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/table-templates", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "템플릿 목록을 불러오지 못했어요.");
        if (!controller.signal.aborted) setTemplates(data.templates);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "목록을 불러오지 못했어요.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [open, mode, reload]);

  async function save() {
    if (saving || !name.trim() || !draft) return;
    setSaving(true); setError("");
    try {
      const format = encodeTable(draft), title = name.trim();
      if (!submission.current || submission.current.name !== title || submission.current.format !== format) {
        submission.current = { id: crypto.randomUUID(), name: title, format };
      }
      const response = await fetch("/api/table-templates", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission.current), signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "템플릿을 저장하지 못했어요.");
      submission.current = null; setName(""); setOpen(false); toast.success("템플릿을 저장했어요.");
    } catch (error) { setError(error instanceof Error ? error.message : "저장하지 못했어요. 다시 시도해 주세요."); }
    finally { setSaving(false); }
  }

  function apply(template: TableTemplate) {
    try { onApply(instantiateTableTemplate(template.format)); setOpen(false); }
    catch (error) { setError(error instanceof Error ? error.message : "템플릿을 불러오지 못했어요."); }
  }

  return <>
    <Button type="button" variant="outline" disabled={disabled} onClick={() => {
      onOpen(); setName(""); setError(""); setTemplates([]); submission.current = null;
      setMode(canSave ? "save" : "load"); setDraft(null); setLoading(!canSave);
      if (canSave) {
        try { setDraft(selectedTableTemplate(doc, selected)); }
        catch (error) { setError(error instanceof Error ? error.message : "선택 영역을 확인해 주세요."); }
      }
      setOpen(true);
    }}><LayoutTemplate />{canSave ? "저장하기" : "불러오기"}</Button>
    <Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value); }}>
      <DialogContent className="table-template-dialog" overlayClassName="table-delete-overlay" onKeyDown={event => event.stopPropagation()} onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); if (!saving) setOpen(false); }}>
        {/* The app's capture-phase Escape router must see this above the table editor (111). */}
        <button type="button" hidden tabIndex={-1} data-photo-back="113" onClick={event => { event.stopPropagation(); if (!saving) setOpen(false); }} />
        <DialogHeader><DialogTitle>{mode === "save" ? "템플릿 저장하기" : "템플릿 불러오기"}</DialogTitle>
          <DialogDescription>{mode === "save" ? "선택한 영역 아래에 빈 행 2개를 붙여 저장합니다. 현재 편집 중인 표는 바뀌지 않아요." : "템플릿을 누르면 현재 표에 바로 적용됩니다. 표 되돌리기로 복원할 수 있어요."}</DialogDescription>
        </DialogHeader>
        {mode === "save" ?
          <section className="table-template-create">
            <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); void save(); }}>
              <label htmlFor="table-template-name">새 템플릿 이름</label>
              <Input id="table-template-name" autoFocus value={name} maxLength={80} disabled={saving} placeholder="예: 단계와 특징" onChange={event => setName(event.target.value)} />
              <p>{draft ? `${draft.rows.length}행 × ${draft.columns.length}열 (빈 행 2개 포함)` : "선택 영역을 확인해 주세요."} · 선택한 내용·병합·칸 색·볼드 표시를 유지합니다.</p>
              <div className="table-template-create-actions"><Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>취소</Button><Button type="submit" disabled={saving || !name.trim() || !draft}>{saving && <Loader2 className="animate-spin" />}저장하기</Button></div>
            </form>
          </section> :
          <div className="table-template-list" aria-label="저장된 템플릿">
            {loading ? <p role="status">템플릿을 불러오는 중…</p> : templates.length ? templates.map(template => {
              const table = readTable(template.format);
              return <button key={template.id} type="button" disabled={!table} className="table-template-item" onClick={() => {
                setError("");
                apply(template);
              }}><LayoutTemplate /><span><strong>{template.name}</strong><small>{table ? `${table.rows.length}행 × ${table.columns.length}열 · ${table.cells.length}칸` : "표를 읽을 수 없어요"}</small></span></button>;
            }) : !error && <p>저장된 템플릿이 없어요. 표에서 여러 칸을 선택한 뒤 [저장하기]를 눌러 주세요.</p>}
          </div>
        }
        {error && <div role="alert" className="table-error"><p>{error}</p>{mode === "load" && <Button type="button" variant="outline" onClick={() => { setLoading(true); setError(""); setReload(value => value + 1); }}>목록 다시 불러오기</Button>}</div>}
      </DialogContent>
    </Dialog>
  </>;
}
