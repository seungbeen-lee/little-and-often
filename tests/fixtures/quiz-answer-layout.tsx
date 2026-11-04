import React from "react";
import { createRoot } from "react-dom/client";
import "../../app/globals.css";

const long = new URLSearchParams(location.search).has("long");
const memo = new URLSearchParams(location.search).has("memo");
const answer = long ? Array.from({ length: 30 }, (_, index) => `정답 ${index + 1}`).join(" · ") : "교과간 연계와 통합, 학습에 대한 성찰, 학생의 삶과 연계된 학습";

createRoot(document.getElementById("root")!).render(
  <main className="app-page is-quiz-tab is-quizzing">
    <div className="app-shell" style={{ display: "flex", flexDirection: "column" }}>
      <div className="tab-page quiz-page">
        <section className="quiz-session">
          <div className="quiz-toolbar"><button>퀴즈 나가기</button></div>
          <div className="quiz-progress-row">2 / 8</div>
          <article className="quiz-card">
            <section className="quiz-question-panel"><span>교육과정</span><p>교과 교육에서 깊이 있는 학습을 통해 역량을 함양할 수 있도록 강화한 내용은 무엇인가요?</p></section>
            <section className="quiz-answer-panel is-checked">
              <div className="quiz-answer-heading"><span className="answer-label is-correct">정답</span></div>
              <div className="quiz-cloze-copy">{answer}</div>
              <div className="quiz-feedback keyword-review-actions">
                {memo && <div className="keyword-review-materials"><aside className="answer-memo"><span>메모</span><p>{Array.from({ length: 18 }, () => "추가 학습 자료").join(" · ")}</p></aside></div>}
                <button type="button">다음 문제</button>
              </div>
            </section>
          </article>
        </section>
      </div>
    </div>
    <nav className="main-tabs-list" aria-label="주요 메뉴">퀴즈 · 학습 · 카드 · 세트</nav>
  </main>
);
