"use client";
import { useEffect, useState } from "react";

type Plan = { total: number; changes: Array<{ id: number; subject: string; question: string; fingerprint: string; before: unknown; after: unknown }>; skipped: Array<{ id: number; question: string; reason: string }> };
async function loadPlan(): Promise<Plan> {
  const response = await fetch("/api/cards/list-bullets", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "목록을 불러오지 못했어요.");
  return data;
}
export default function ListBulletMaintenance() {
  const [plan, setPlan] = useState<Plan | null>(null), [backedUp, setBackedUp] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const load = async () => {
    const data = await loadPlan();
    setPlan(data); setBackedUp(false);
  };
  useEffect(() => {
    let active = true;
    void loadPlan().then(data => { if (active) setPlan(data); }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, []);
  const backup = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `little-often-list-backup-${new Date().toISOString().replaceAll(":", "-")}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000); setBackedUp(true);
  };
  const apply = async () => {
    if (!plan || !backedUp || busy) return;
    setBusy(true); let changed = 0, conflicts = 0;
    try {
      for (let index = 0; index < plan.changes.length; index += 50) {
        const response = await fetch("/api/cards/list-bullets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: plan.changes.slice(index, index + 50).map(({ id, fingerprint }) => ({ id, fingerprint })) }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "변환을 완료하지 못했어요.");
        changed += data.changed.length; conflicts += data.conflicts.length;
      }
      await load(); setMessage(`${changed}개 카드의 목록 기호를 •로 변경했습니다. 학습 기록·보관 상태·정답 키워드는 유지했습니다.${conflicts ? ` 변경 중 수정된 ${conflicts}개 카드는 건너뛰었습니다.` : ""}`);
    } catch (error) { setMessage(`${changed}개 반영 후 중단: ${error instanceof Error ? error.message : "오류가 발생했어요."}`); }
    finally { setBusy(false); }
  };
  return <main style={{ maxWidth: 800, margin: "40px auto", padding: 24 }}>
    <h1 style={{ fontSize: 26, marginBottom: 16 }}>기존 목록 기호 정리</h1>
    <p>줄 앞의 목록 표시만 - 에서 •로 바꿉니다. 문장 안 하이픈, 음수, 정답 키워드와 학습 기록은 유지합니다.</p>
    {plan && <>
      <p style={{ margin: "20px 0" }}>전체 {plan.total}개 · 변환 대상 {plan.changes.length}개 · 검토 필요 {plan.skipped.length}개</p>
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <button className="rounded-xl border px-4 py-3" disabled={busy || !plan.changes.length} onClick={backup}>변경 전 원본 다운로드</button>
        <button className="rounded-xl bg-[#185b47] px-4 py-3 text-white disabled:opacity-40" disabled={!backedUp || busy || !plan.changes.length} onClick={() => void apply()}>{busy ? "변환 중…" : "목록 기호 변경"}</button>
      </div>
    </>}
    {message && <p role="status" style={{ background: "#e3efe6", padding: 20, borderRadius: 12 }}>{message}</p>}
    {plan?.skipped.map(item => <p key={item.id}>{item.question}: {item.reason}</p>)}
    <details style={{ marginTop: 20 }}><summary>변경 대상 카드</summary>{plan?.changes.map(item => <p key={item.id}>{item.subject} · {item.question}</p>)}</details>
    {/* Reload the app after maintenance so it fetches the changed card data. */}
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
    <a href="/" style={{ display: "inline-block", marginTop: 24 }}>학습장으로 돌아가기</a>
  </main>;
}
