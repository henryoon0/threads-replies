"use client";

// 스레드 레일 "학습" 묶음의 화면. 계정(페르소나)마다 따로 — 서버는 쿠키로 계정을 가른다.
import { LearnProgress } from "./learn-progress";
import { LearnReview } from "./learn-review";
import { LearnRules } from "./learn-rules";
import { LearnVoice } from "./learn-voice";
import type { LearnView } from "./threads-place";

export function ThreadsLearn({ view, persona }: { view: LearnView; persona: string }) {
  if (view === "review") return <LearnReview persona={persona} />;
  if (view === "rules") return <LearnRules persona={persona} />;
  if (view === "progress") return <LearnProgress persona={persona} />;
  return <LearnVoice persona={persona} />;
}
