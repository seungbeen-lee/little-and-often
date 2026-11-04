"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { DEFAULT_EXAM_DATE, dayCountdown, isValidDayDate } from "../lib/exam-dday";

const DayContext = createContext({ label: "D-day", targetDate: DEFAULT_EXAM_DATE, open: () => {} });

export function DaySettingButton() {
  const day = useContext(DayContext);
  return <Button type="button" variant="outline" className="daily-stats-button day-setting-button" onClick={day.open} aria-label={`D-day 설정, ${day.targetDate}, ${day.label}`} title={`${day.targetDate} · 날짜 변경`}>
    <span className="day-setting-readout"><small>D-day</small><span className="daily-stats-value" suppressHydrationWarning>{day.label}</span></span>
  </Button>;
}

export function DaySettingProvider({ children }: { children: ReactNode }) {
  const [targetDate, setTargetDate] = useState(DEFAULT_EXAM_DATE);
  const [draft, setDraft] = useState(DEFAULT_EXAM_DATE);
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/settings/day", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !isValidDayDate(data.targetDate)) throw new Error("load");
        if (controller.signal.aborted) return;
        setTargetDate(data.targetDate); setDraft(data.targetDate); setLoaded(true); setError("");
      })
      .catch(() => { if (!controller.signal.aborted) setError("날짜를 불러오지 못했어요. 다시 시도해주세요."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  async function save() {
    if (!loaded || saving || !isValidDayDate(draft)) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/settings/day", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetDate: draft }) });
      const data = await response.json();
      if (!response.ok || !isValidDayDate(data.targetDate)) throw new Error("save");
      setTargetDate(data.targetDate); setOpen(false);
    } catch { setError("저장하지 못했어요. 선택한 날짜는 유지돼요. 다시 저장해주세요."); }
    finally { setSaving(false); }
  }
  return <DayContext.Provider value={{ label: dayCountdown(targetDate, now), targetDate, open: () => { setDraft(targetDate); if (loaded) setError(""); setOpen(true); } }}>
    {children}
    <Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value); }}>
      <DialogContent className="day-setting-dialog" showCloseButton={!saving}>
        <DialogHeader><DialogTitle>D-day 설정</DialogTitle><DialogDescription>목표 날짜까지 남은 날을 표시해요. 기본 날짜는 2026년 11월 7일이에요.</DialogDescription></DialogHeader>
        <form onSubmit={event => { event.preventDefault(); void save(); }}>
          <label htmlFor="day-target-date">목표 날짜</label>
          <Input id="day-target-date" type="date" min="1900-01-01" max="9999-12-31" required value={draft} disabled={loading || !loaded || saving} onChange={event => setDraft(event.target.value)} />
          {error && <p role="alert" className="day-setting-error">{error}</p>}
          {!loaded && !loading && <Button type="button" variant="outline" onClick={() => { setLoading(true); setError(""); setReload(value => value + 1); }}>다시 불러오기</Button>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={!loaded || saving} onClick={() => setDraft(DEFAULT_EXAM_DATE)}>기본 날짜</Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>취소</Button>
            <Button type="submit" disabled={!loaded || saving || !isValidDayDate(draft)}>{saving ? "저장 중…" : "저장"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </DayContext.Provider>;
}
