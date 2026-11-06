"use client";
import { useEffect, useRef } from "react";

export const ANSWER_FEEDBACK_HOLD_MS = 450;
const feedbackScrolls = new WeakMap<HTMLElement, { timer: number; moving: boolean }>();
function clearFeedbackScroll(root: HTMLElement) {
  const pending = feedbackScrolls.get(root);
  if (pending) window.clearTimeout(pending.timer);
  feedbackScrolls.delete(root);
  delete root.dataset.answerFeedback;
}
function finishFeedbackScroll(root: HTMLElement) {
  const pending = feedbackScrolls.get(root);
  if (!pending || pending.moving) return;
  window.clearTimeout(pending.timer);
  const input = document.activeElement;
  if (!root.isConnected || !(input instanceof HTMLElement) || !root.contains(input)
    || !input.matches("input, textarea") || document.querySelector('[role="dialog"], [role="alertdialog"]')) {
    clearFeedbackScroll(root);
    return;
  }
  pending.moving = true;
  revealMobileStudyInput(input, true);
  // Focus/viewport events must not interrupt the browser's smooth scroll.
  pending.timer = window.setTimeout(() => clearFeedbackScroll(root), 350);
}

/** Move focus immediately to preserve fast typing/iOS keyboard, but let green
 * feedback remain in view briefly before following the new field. */
export function deferMobileAnswerScroll(node: HTMLElement | null | undefined, delay = ANSWER_FEEDBACK_HOLD_MS) {
  const root = node?.closest<HTMLElement>(".mobile-session-layout");
  if (!root || !window.matchMedia?.("(max-width: 759px)").matches) return;
  // A navigation request can use the pending scroll from an accepted answer.
  if (delay === 0 && feedbackScrolls.has(root)) return;
  clearFeedbackScroll(root);
  const pending = { timer: 0, moving: false };
  feedbackScrolls.set(root, pending);
  root.dataset.answerFeedback = "pending";
  pending.timer = window.setTimeout(() => finishFeedbackScroll(root), delay);
}

function inputPosition(node: HTMLElement) {
  const field = node.getBoundingClientRect();
  if (!(node instanceof HTMLTextAreaElement) || field.height < 100) return field;
  // Measure the actual caret for long, growing textareas, not their bottom edge.
  const style = getComputedStyle(node), mirror = document.createElement("div");
  for (const property of ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "padding", "border", "text-indent", "tab-size"]) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
  Object.assign(mirror.style, { position: "fixed", top: "0", left: "0", visibility: "hidden", pointerEvents: "none", width: `${field.width}px`, boxSizing: "border-box", whiteSpace: "pre-wrap", overflowWrap: "break-word" });
  mirror.textContent = node.value.slice(0, node.selectionEnd);
  const caret = document.createElement("span"); caret.textContent = "\u200b"; mirror.append(caret);
  document.body.append(mirror);
  const position = caret.getBoundingClientRect();
  const top = field.top + position.top - node.scrollTop;
  const height = position.height || parseFloat(style.lineHeight) || 24;
  mirror.remove();
  return { top, bottom: top + height, left: field.left, right: field.right };
}

/** Reveal inside the one mobile card scroller; never move the document. */
export function revealMobileStudyInput(node: HTMLElement, smooth = false) {
  if (typeof window === "undefined" || !window.matchMedia?.("(max-width: 759px)").matches) return false;
  const root = node.closest<HTMLElement>(".mobile-session-layout");
  const scroller = node.closest<HTMLElement>(".study-card, .quiz-card");
  if (!root || !scroller || !window.matchMedia("(max-width: 759px)").matches) return false;
  if (!smooth && feedbackScrolls.has(root)) return true;
  const focused = document.activeElement;
  const target = focused instanceof HTMLElement && node.contains(focused) ? focused : node;
  const frame = scroller.getBoundingClientRect(), field = inputPosition(target);
  const visual = window.visualViewport;
  const title = scroller.querySelector<HTMLElement>(".session-heading-overflow > .question-panel-top, .session-heading-overflow > .session-card-meta, .question-panel:not(.session-heading-overflow), .quiz-question-panel:not(.session-heading-overflow)");
  const pinnedTitleHeight = title && getComputedStyle(title).position === "sticky"
    ? Math.max(0, title.getBoundingClientRect().height + (parseFloat(getComputedStyle(title).top) || 0)) : 0;
  const top = Math.max(frame.top + pinnedTitleHeight, visual?.offsetTop ?? 0) + 12;
  // visualViewport usually includes the keyboard accessory strip, but leave a
  // further finger-sized margin for iOS keyboard/AutoFill transitions.
  const bottom = Math.min(frame.bottom, (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight)) - 48;
  if (bottom <= top) return true;
  scroller.style.setProperty("--study-input-tail", `${Math.ceil((bottom - top) * .62 + 48)}px`);
  // Keep the active line just above the centre of the unobscured area. Only
  // recenter when it leaves this small band, so typing/IME doesn't jiggle it.
  const targetTop = top + Math.max(0, bottom - top - (field.bottom - field.top)) * .38;
  if (field.top < targetTop - 18 || field.bottom > bottom || field.top > targetTop + 18) {
    const nextTop = scroller.scrollTop + field.top - targetTop;
    if (smooth) scroller.scrollTo({ top: nextTop, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    else scroller.scrollTop = nextTop;
  } else if (smooth) {
    // A second navigation may leave the previous animation in progress.
    scroller.scrollTo({ top: scroller.scrollTop, behavior: "instant" });
  }
  const horizontal = node.closest<HTMLElement>(".answer-table-scroll");
  if (horizontal) {
    const rect = horizontal.getBoundingClientRect();
    if (field.left < rect.left + 6) horizontal.scrollLeft += field.left - rect.left - 6;
    else if (field.right > rect.right - 6) horizontal.scrollLeft += field.right - rect.right + 6;
  }
  return true;
}

export function useMobileStudyViewport(active: boolean) {
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!active || !root) return;
    const query = window.matchMedia("(max-width: 759px)");
    const visual = window.visualViewport;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!query.matches) { root.classList.remove("mobile-session-layout"); return; }
        root.classList.add("mobile-session-layout");
        const focused = document.activeElement;
        const editing = focused instanceof HTMLElement && root.contains(focused) && focused.matches("input, textarea, [contenteditable=true]");
        // An accepted field is replaced with green text before the next focus.
        // Keep keyboard geometry for that commit instead of expanding/collapsing.
        if (!editing && feedbackScrolls.has(root)) return;
        root.style.setProperty("--session-height", `${visual?.height ?? window.innerHeight}px`);
        root.style.setProperty("--session-top", `${visual?.offsetTop ?? 0}px`);
        const keyboard = editing && window.innerHeight - (visual?.height ?? window.innerHeight) > 100;
        root.dataset.sessionKeyboard = keyboard ? "open" : "closed";
        for (const heading of root.querySelectorAll<HTMLElement>(".question-panel, .quiz-question-panel")) {
          const contentHeight = [...heading.children].reduce((height, child) => height + child.getBoundingClientRect().height, 0);
          // Reserve room for the current answer when a question spans many lines.
          heading.classList.toggle("session-heading-overflow", contentHeight > (visual?.height ?? window.innerHeight) * .45);
          const pinned = heading.classList.contains("session-heading-overflow") ? heading.firstElementChild : heading;
          const section = heading.querySelector<HTMLElement>(".section-path");
          if (pinned && section) {
            const metadataHeight = section.getBoundingClientRect().top - pinned.getBoundingClientRect().top;
            heading.style.setProperty("--session-meta-offset", `${Math.max(0, Math.round(metadataHeight - 4))}px`);
          }
        }
        if (editing && focused instanceof HTMLTextAreaElement && focused.classList.contains("typed-textarea")) {
          focused.style.height = "auto";
          focused.style.height = `${Math.max(150, focused.scrollHeight)}px`;
        }
        if (editing) revealMobileStudyInput(focused);
      });
    };
    const handleInput = () => { finishFeedbackScroll(root); update(); };
    const cancelFeedback = () => clearFeedbackScroll(root);
    const handleNavigation = (event: KeyboardEvent) => {
      if (["Tab", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) clearFeedbackScroll(root);
    };
    update();
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    root.addEventListener("focusin", update);
    root.addEventListener("focusout", update);
    root.addEventListener("input", handleInput);
    root.addEventListener("pointerdown", cancelFeedback);
    root.addEventListener("keydown", handleNavigation);
    root.addEventListener("keyup", update);
    return () => {
      cancelAnimationFrame(frame);
      clearFeedbackScroll(root);
      root.classList.remove("mobile-session-layout");
      delete root.dataset.sessionKeyboard;
      root.style.removeProperty("--session-height"); root.style.removeProperty("--session-top");
      visual?.removeEventListener("resize", update); visual?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      root.removeEventListener("focusin", update); root.removeEventListener("focusout", update); root.removeEventListener("input", handleInput);
      root.removeEventListener("pointerdown", cancelFeedback);
      root.removeEventListener("keydown", handleNavigation);
      root.removeEventListener("keyup", update);
    };
  }, [active]);
  return rootRef;
}
