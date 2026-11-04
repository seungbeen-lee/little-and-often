import React from "react";
import { createRoot } from "react-dom/client";
import { DaySettingButton, DaySettingProvider } from "../../components/day-setting";
import { DailyStatsReadout, StudyModeSwitch } from "../../app/study-app";
import { Button } from "../../components/ui/button";
import { ArrowLeft, Cloud } from "lucide-react";
import "../../app/globals.css";

const stats = <div className="daily-summary-controls"><DaySettingButton /><Button className="daily-stats-button"><DailyStatsReadout count={3} accuracy={80} /></Button></div>;
createRoot(document.getElementById("root")!).render(<DaySettingProvider><main className="app-shell">
  <header className="app-header"><div><div className="brand-line"><span className="brand-mark" /><span>little and often</span></div><p><span className="desktop-card-count">학습 95장 · 보관 3장 · 1개 세트</span><span className="mobile-card-count">카드 98장</span></p></div><div className="app-header-actions">{stats}<span className="sync-pill" aria-label="동기화"><Cloud /><span>동기화</span></span></div></header>
  <section className="study-toolbar"><div className="selected-subject-row"><Button variant="ghost" className="selected-subject"><ArrowLeft /><span><small>선택한 과목</small><strong>체육</strong></span></Button><div className="study-heading-actions">{stats}<StudyModeSwitch mode="practice" onCheckedChange={() => {}} /><Button className="heading-add">+</Button></div></div></section>
</main></DaySettingProvider>);
