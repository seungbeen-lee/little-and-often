"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import type { TableTabOrder } from "../lib/table-card";

export type ShortcutScreen =
  | "home" | "cards" | "sets" | "set-selection" | "study-ready"
  | "study-keywords" | "study-table" | "study-write" | "quiz-ready"
  | "quiz-keywords" | "quiz-table" | "quiz-review" | "paused"
  | "card-editor" | "bulk-editor" | "set-editor" | "table-editor"
  | "flow-view" | "card-view" | "range-picker" | "dialog";

type HelpRow = { keys: string; action: string };
type HelpContent = { title: string; description: string; rows: HelpRow[] };
const common: HelpRow = { keys: "F1", action: "이 도움말 열기" };
const back: HelpRow = { keys: "Esc", action: "현재 창 닫기 또는 이전 화면으로 돌아가기" };
const tab: HelpRow = { keys: "Tab / Shift+Tab", action: "다음 / 이전 입력칸으로 이동. Shift+Tab은 Shift를 누른 채 Tab을 누르세요." };
const hint: HelpRow = { keys: "Ctrl/⌘ + Enter", action: "현재 빈칸의 힌트 보기(사용 가능한 풀이에서)" };
const tableMove: HelpRow = { keys: "Tab / Shift+Tab", action: "선택한 방향의 다음 / 이전 빈칸으로 이동해요. 한 칸의 빈칸은 이어서 이동합니다. Shift+Tab은 Shift를 누른 채 Tab을 누르세요." };
const lists: HelpRow[] = [{ keys: "- 다음 공백", action: "질문·답·표 셀의 줄 맨 앞에서 • 목록 시작" }, { keys: "목록 안 Tab / Shift+Tab", action: "하위 목록으로 들여쓰기 / 내어쓰기. 입력칸을 이동하지 않아요" }, { keys: "목록 안 Shift+Enter", action: "다음 목록 항목. 빈 항목에서는 한 단계 내어쓰기, 최상위에서는 목록 종료. Enter는 기존 칸 이동" }];
const arrows: HelpRow = { keys: "방향키", action: "글 안에서는 커서를 움직이고, 경계에서는 표의 위·아래·좌·우 빈칸으로 이동" };

export const shortcutHelpContent: Record<ShortcutScreen, HelpContent> = {
  home: { title: "학습 홈", description: "과목을 선택해 학습을 시작하세요.", rows: [common, { keys: "Tab / Shift+Tab", action: "화면의 다음 / 이전 버튼으로 이동" }, { keys: "Enter / Space", action: "선택한 버튼 실행" }] },
  cards: { title: "카드", description: "검색과 과목 필터로 카드를 찾고, 카드의 편집·보관 기능을 사용할 수 있어요.", rows: [common, { keys: "Tab / Shift+Tab", action: "검색칸과 카드의 버튼 사이 이동" }, { keys: "Enter / Space", action: "현재 선택된 버튼 실행" }, back] },
  sets: { title: "세트", description: "과목으로 걸러보거나 이름·내용을 검색하고, 세트를 열거나 학습할 세트를 선택할 수 있어요.", rows: [common, { keys: "Tab / Shift+Tab", action: "세트와 버튼 사이 이동" }, { keys: "Enter / Space", action: "현재 선택된 버튼 실행" }, back] },
  "set-selection": { title: "세트 학습 선택", description: "원하는 세트를 고른 뒤 시작하세요.", rows: [common, { keys: "Esc", action: "세트 선택 취소" }, { keys: "Enter / Space", action: "현재 선택된 세트 또는 버튼 실행" }] },
  "study-ready": { title: "학습 준비", description: "이어하기, 처음부터 또는 학습 범위 정하기를 선택하세요.", rows: [common, { keys: "Esc", action: "과목 선택 화면으로 돌아가기" }, { keys: "Enter / Space", action: "현재 선택된 버튼 실행" }] },
  "study-keywords": { title: "키워드 학습", description: "빈칸을 채우고, 오답은 같은 자리에서 다시 써보세요.", rows: [common, tab, hint, { keys: "Esc", action: "실전 모드의 타이머 일시정지·재개" }] },
  "study-table": { title: "표 학습", description: "빈칸 번호는 Tab으로 이동하는 순서와 같아요.", rows: [common, tableMove, arrows, hint, { keys: "Esc", action: "실전 모드의 타이머 일시정지·재개" }] },
  "study-write": { title: "전부 써보기", description: "자유롭게 답을 쓰고 확인하세요.", rows: [common, { keys: "Enter", action: "작성한 답 확인" }, { keys: "Shift+Enter", action: "입력칸 안에서 줄바꿈" }, { keys: "Esc", action: "실전에서는 일시정지·재개, 연습의 정답 확인 후에는 다시 쓰기" }] },
  "quiz-ready": { title: "퀴즈 준비", description: "과목을 고르고 퀴즈를 시작하세요.", rows: [common, { keys: "Tab / Shift+Tab", action: "선택 항목 사이 이동" }, { keys: "Enter / Space", action: "현재 선택된 버튼 실행" }, back] },
  "quiz-keywords": { title: "키워드 퀴즈", description: "정답을 입력하고, 채점 뒤 틀린 키워드를 다시 써보세요.", rows: [common, tab, hint, { keys: "Esc", action: "퀴즈 일시정지 · 일시정지 중에는 다시 시작" }] },
  "quiz-table": { title: "표 퀴즈", description: "빈칸 번호는 Tab으로 이동하는 순서와 같아요.", rows: [common, tableMove, arrows, hint, { keys: "Enter", action: "교정을 마친 뒤 다음 문제로 이동" }, { keys: "Esc", action: "퀴즈 일시정지 · 일시정지 중에는 다시 시작" }] },
  "quiz-review": { title: "퀴즈 정답 확인", description: "틀린 키워드를 모두 고쳐 쓴 뒤 다음 문제로 이동해요.", rows: [common, { keys: "Enter", action: "교정을 마친 뒤 다음 문제로 이동" }, { keys: "Esc", action: "퀴즈 일시정지 · 일시정지 중에는 다시 시작" }] },
  paused: { title: "일시정지", description: "시간과 풀이가 멈춰 있어요.", rows: [common, { keys: "Esc / Enter", action: "학습 또는 퀴즈 다시 시작" }] },
  "card-editor": { title: "카드 편집", description: "질문과 답의 굵은 글씨는 서로 다른 키워드 역할을 해요.", rows: [common, ...lists, { keys: "Ctrl/⌘ + B", action: "선택한 문구 굵게 지정" }, { keys: "Ctrl/⌘ + U", action: "질문의 선택 문구 밑줄" }, { keys: "Tab / Shift+Tab", action: "입력 항목 사이 이동" }, back] },
  "bulk-editor": { title: "카드 여러 장 편집", description: "행과 칸을 이동하며 여러 카드를 함께 수정할 수 있어요.", rows: [common, ...lists, { keys: "클릭 / Shift+클릭", action: "PC: 좌우 여백에서 카드 선택 / 범위 선택. 입력칸·분류·핸들·도구 버튼은 제외" }, { keys: "Ctrl/⌘ + 클릭", action: "PC: 개별 카드 추가·해제. 선택 삭제 또는 세트 버튼으로 작업" }, { keys: "Tab / Enter", action: "분류 → 질문 → 답 → 메모 순서로 이동. 메모에서는 새 카드 추가" }, { keys: "Ctrl/⌘ + Shift+Enter", action: "입력 중인 카드를 바로 아래에 복제. 카드 사이 추가 버튼에서는 위 카드 복제" }, { keys: "Shift+Enter", action: "질문·답·메모 안에서 줄바꿈" }, { keys: "Shift+Tab", action: "메모 → 답 → 질문 → 분류 역순 이동. 분류에서는 이전 카드의 메모로 이동하며 버튼은 건너뛰어요" }, { keys: "Backspace", action: "카드 전체 또는 섹션 제목이 비어 있으면 두 단계 삭제 확인. 그 외 맨 앞에서 메모 → 답, 답 → 질문 이동. 글 중간에서는 삭제" }, { keys: "Ctrl/⌘ + Z", action: "되돌리기" }, { keys: "Ctrl/⌘ + Shift+Z", action: "다시 실행" }, { keys: "방향키", action: "글의 경계에서 인접한 편집칸으로 이동" }, back] },
  "set-editor": { title: "세트 편집", description: "카드를 선택하고 제목·설명을 저장하세요.", rows: [common, { keys: "Esc", action: "선택 단계 취소 또는 편집창 닫기" }, { keys: "Tab / Shift+Tab", action: "항목 사이 이동" }] },
  "table-editor": { title: "표 편집", description: "굵게 지정한 문구만 시험에서 빈칸이 돼요.", rows: [common, ...lists, { keys: "F8", action: "선택한 칸 정렬: 왼쪽 → 가운데 → 오른쪽 → 양쪽. 여러 칸도 함께 적용(필요 시 Fn+F8)" }, { keys: "Shift+클릭 / Ctrl/⌘+클릭", action: "PC: 사각 범위 선택 / 개별 칸 추가·해제" }, { keys: "Ctrl/⌘ + A", action: "PC: 칸 선택 상태에서는 전체 칸 선택. 글 편집 중에는 글자 전체 선택" }, { keys: "Tab / Enter", action: "오른쪽 칸 / 아래 칸으로 이동. 끝에서는 열 / 행 추가" }, { keys: "Shift+Enter", action: "칸 안에서 줄바꿈" }, { keys: "Ctrl/⌘ + B", action: "선택한 문구 또는 여러 칸을 한 번에 키워드로 지정" }, { keys: "Ctrl/⌘ + M", action: "선택한 칸 병합 / 병합 해제" }, { keys: "Ctrl/⌘ + P", action: "선택한 칸 흰색 / 회색 전환" }, { keys: "Ctrl/⌘ + \\", action: "선택한 열의 현재 너비 고정 / 해제" }, { keys: "Ctrl/⌘ + Z / Shift+Z", action: "되돌리기 / 다시 실행" }, { keys: "Esc", action: "칸 편집 종료 또는 창 닫기" }] },
  "flow-view": { title: "표로 전체 보기", description: "여러 카드를 이어 보고 세트에 넣을 카드를 고를 수 있어요.", rows: [common, { keys: "Shift + 클릭", action: "세트에 넣을 카드 선택" }, { keys: "Esc", action: "카드 선택을 취소하거나 창 닫기" }] },
  "card-view": { title: "카드로 보기", description: "카드를 넘기며 내용을 살펴보세요.", rows: [common, { keys: "Esc", action: "카드 보기 창 닫기" }, { keys: "Tab / Shift+Tab", action: "버튼 사이 이동" }] },
  "range-picker": { title: "학습 범위 정하기", description: "학습할 섹션과 카드를 골라 시작하세요.", rows: [common, { keys: "Tab / Shift+Tab", action: "선택 항목 사이 이동" }, back] },
  dialog: { title: "현재 창", description: "열려 있는 창의 작업을 마친 뒤 이전 화면으로 돌아갈 수 있어요.", rows: [common, back, { keys: "Tab / Shift+Tab", action: "창 안의 다음 / 이전 항목으로 이동" }, { keys: "Enter / Space", action: "현재 선택된 버튼 실행" }] },
};

export function foregroundShortcutScreen(doc: Pick<Document, "querySelectorAll">): ShortcutScreen | null {
  const dialogs = [...doc.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')]
    .filter((node) => !node.classList.contains("shortcut-help-dialog") && node.getClientRects().length > 0);
  const top = dialogs.at(-1);
  if (!top) return null;
  if (top.classList.contains("table-editor-dialog")) return "table-editor";
  if (top.classList.contains("set-editor-dialog")) return "set-editor";
  if (top.classList.contains("bulk-dialog")) return "bulk-editor";
  if (top.classList.contains("card-editor-dialog")) return "card-editor";
  if (top.classList.contains("flow-dialog")) return "flow-view";
  if (top.classList.contains("mobile-cards-dialog") || top.classList.contains("card-detail-dialog")) return "card-view";
  if (top.classList.contains("start-order-dialog")) return "range-picker";
  if (top.classList.contains("study-clock-stage")) return "paused";
  return "dialog";
}

export function ShortcutHelp({ screen, tableTabOrder = "vertical", onTableTabOrderChange }: {
  screen: ShortcutScreen;
  tableTabOrder?: TableTabOrder;
  onTableTabOrderChange?: (order: TableTabOrder) => void;
}) {
  const [open, setOpen] = useState(false);
  const [shownScreen, setShownScreen] = useState<ShortcutScreen>(screen);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const openOnF1 = (event: KeyboardEvent) => {
      if (open && event.key === "Escape" && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        return;
      }
      if (event.key !== "F1" || event.repeat || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (open) return;
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setShownScreen(foregroundShortcutScreen(document) ?? screen);
      setOpen(true);
    };
    window.addEventListener("keydown", openOnF1, true);
    return () => window.removeEventListener("keydown", openOnF1, true);
  }, [open, screen]);
  const content = shortcutHelpContent[shownScreen];
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent className="shortcut-help-dialog" overlayClassName="shortcut-help-overlay"
      data-help-screen={shownScreen}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
      }}>
      <DialogHeader className="text-left pr-8">
        <DialogTitle>단축키 · {content.title}</DialogTitle>
        <DialogDescription>{content.description}</DialogDescription>
      </DialogHeader>
      <div className="shortcut-help-list">
        {content.rows.map((row) => <div className="shortcut-help-row" key={`${shownScreen}-${row.keys}`}>
          <kbd>{row.keys}</kbd><span>{row.action}</span>
        </div>)}
      </div>
      {(shownScreen === "study-table" || shownScreen === "quiz-table") && <fieldset className="shortcut-help-table-order">
        <legend>표에서 Tab 이동 방향</legend>
        <div className="shortcut-help-table-order-options">
          <label><input type="radio" name="table-tab-order" value="vertical" checked={tableTabOrder === "vertical"} onChange={() => onTableTabOrderChange?.("vertical")} />세로 <small>같은 열의 아래 행으로</small></label>
          <label><input type="radio" name="table-tab-order" value="horizontal" checked={tableTabOrder === "horizontal"} onChange={() => onTableTabOrderChange?.("horizontal")} />가로 <small>같은 행의 오른쪽 칸으로</small></label>
        </div>
        <p>설정은 이 기기에 저장되며 표 학습·퀴즈의 Tab 순서와 빈칸 번호에 함께 적용돼요. 방향키는 표의 실제 위치대로 이동해요.</p>
      </fieldset>}
      <p className="shortcut-help-footnote">Esc로 이 창을 닫을 수 있어요. 입력 중 한글을 조합할 때는 이동 단축키가 실행되지 않아요.</p>
    </DialogContent>
  </Dialog>;
}
