"use client";

// 계정 연결 안내 — 받는 사람이 처음 여는 화면.
// 위: AI(aside)에게 맡기는 한 줄. 아래: 직접 할 때의 순서. 마지막 칸에 토큰을 붙여넣으면 서버가 스레드에 물어 검증한다.
// 메뉴 이름은 메타 공식 문서(Threads API Get Started, 2026-06)와 User Token Generator 사용 사례로 확인했다.
import { useState } from "react";
import { ArrowTopRightOnSquareIcon, CheckCircleIcon, ExclamationTriangleIcon, SparklesIcon } from "@heroicons/react/16/solid";

interface Step {
  title: string;
  body: React.ReactNode;
  link?: { href: string; label: string };
}

const ASIDE_CMD = "bash ~/.threads-replies/app/scripts/connect-with-aside.sh";

const STEPS: Step[] = [
  {
    title: "스레드 계정이 공개인지 확인해 주세요",
    body: (
      <>
        스레드 앱 &gt; 설정 &gt; <b>개인정보 보호</b>에서 <b>비공개 프로필</b>이 꺼져 있어야 해요. 비공개 계정은 토큰을 만들 수
        없어요.
      </>
    ),
  },
  {
    title: "메타 개발자 사이트에서 앱을 하나 만들어 주세요",
    body: (
      <>
        페이스북 계정으로 로그인한 뒤 <b>앱 만들기(Create App)</b>를 누르고, 사용 사례는 <b>Threads API 액세스(Access the Threads API)</b>를
        고르세요. 앱 이름은 아무거나 괜찮아요. 내 계정만 쓰는 앱이라 앱 심사는 필요 없습니다.
      </>
    ),
    link: { href: "https://developers.facebook.com/apps/creation/", label: "메타 앱 만들기 열기" },
  },
  {
    title: "권한 5개를 먼저 추가해 주세요",
    body: (
      <>
        만든 앱의 <b>사용 사례 &gt; Threads API 액세스 &gt; 맞춤 설정(Customize)</b>에서{" "}
        <code>threads_basic</code>, <code>threads_read_replies</code>, <code>threads_manage_replies</code>,{" "}
        <code>threads_content_publish</code>, <code>threads_manage_insights</code>를 추가하세요.{" "}
        <b>토큰을 만들기 전에</b> 추가해야 해요. 순서가 바뀌면 토큰은 되는데 답글 보내기가 실패합니다.
      </>
    ),
  },
  {
    title: "나를 테스터로 초대하고, 스레드에서 수락해 주세요",
    body: (
      <>
        앱 대시보드 &gt; <b>앱 역할 &gt; 역할 &gt; 사람 추가 &gt; Threads 테스터</b>에 내 스레드 아이디를 넣어요. 그다음 스레드 앱 &gt;
        설정 &gt; 계정 &gt; <b>웹사이트 권한 &gt; 초대</b>에서 수락을 누르세요. 수락 버튼 없이 &quot;삭제&quot;만 보이면 메타 쪽 오류라,
        앱을 새로 만들어 다시 초대하면 풀린 사례가 있어요.
      </>
    ),
  },
  {
    title: "토큰을 만들어 복사해 주세요",
    body: (
      <>
        <b>사용 사례 &gt; Threads API 액세스 &gt; 설정(Settings)</b> 맨 아래 <b>User Token Generator</b>에서 내 아이디 옆{" "}
        <b>Generate Access Token</b>을 누르고, 뜨는 창에서 계속 &gt; <b>I understand</b>를 체크한 뒤 긴 글자(토큰)를 전부
        복사하세요. 60일짜리이고, 이 앱이 켜져 있으면 알아서 연장해요.
      </>
    ),
    link: { href: "https://developers.facebook.com/apps/", label: "내 메타 앱 목록 열기" },
  },
];

interface ConnectResponse {
  ok?: boolean;
  username?: string;
  error?: string;
}

export function SetupGuide({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState("");
  const [intro, setIntro] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectResponse | null>(null);

  const connect = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, intro }),
      });
      const body = (await res.json()) as ConnectResponse;
      setResult(res.ok ? body : { error: body.error ?? "연결하지 못했어요." });
      if (res.ok) setToken("");
    } catch {
      setResult({ error: "앱 서버에 닿지 못했어요. 앱이 켜져 있는지 확인해 주세요." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="eyebrow">처음 한 번만</p>
      <h1 className="text-display mt-1 text-2xl text-neutral-900">내 스레드 계정을 연결해 주세요</h1>
      <p className="mt-2 text-sm leading-relaxed text-neutral-500">
        메타가 본인만 할 수 있게 막아 둔 일이라 앱이 대신할 수 없어요. 15분쯤 걸립니다. 토큰은 이 컴퓨터에만 저장되고, 다른 곳으로
        보내지 않아요.
      </p>

      <section className="mt-8 rounded-2xl bg-white p-5 ring-1 ring-neutral-950/5 shadow-card">
        <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">
          <SparklesIcon className="size-4 text-emerald-700" />
          AI에게 맡기기 (Aside 브라우저가 있을 때)
        </p>
        <p className="mt-1 break-keep text-[13px] leading-relaxed text-neutral-600">
          터미널에 아래 한 줄을 붙여넣으면 AI가 Aside 브라우저로 아래 1~5단계를 대신 진행하고, 토큰을 이 화면에 바로 붙여넣어요.
          로그인이 필요할 때만 멈추고 알려 줍니다. 비밀번호는 AI가 치지 않아요.
        </p>
        <code className="mt-3 block select-all rounded-xl bg-neutral-50 p-3 font-mono text-xs text-neutral-800 ring-1 ring-neutral-950/5">
          {ASIDE_CMD}
        </code>
      </section>

      <p className="mt-8 text-xs font-medium text-neutral-500">직접 할 때</p>
      <ol className="mt-2 space-y-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-4 rounded-2xl bg-white p-5 ring-1 ring-neutral-950/5 shadow-card">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-sm font-semibold tabular-nums text-emerald-700">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-900">{step.title}</p>
              <p className="mt-1 break-keep text-[13px] leading-relaxed text-neutral-600">{step.body}</p>
              {step.link ? (
                <a
                  href={step.link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-medium text-emerald-700 hover:text-emerald-800"
                >
                  {step.link.label}
                  <ArrowTopRightOnSquareIcon className="size-3.5" />
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-neutral-950/5 shadow-card">
        <label htmlFor="token" className="text-sm font-medium text-neutral-900">
          복사한 토큰을 붙여넣으세요
        </label>
        <textarea
          id="token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          placeholder="TH로 시작하는 긴 글자"
          className="mt-2 w-full resize-none rounded-xl bg-neutral-50 p-3 font-mono text-xs text-neutral-800 ring-1 ring-neutral-950/5 outline-none focus:ring-2 focus:ring-emerald-600"
        />
        <label htmlFor="intro" className="mt-4 block text-sm font-medium text-neutral-900">
          나를 한 줄로 소개해 주세요 <span className="font-normal text-neutral-500">(선택)</span>
        </label>
        <input
          id="intro"
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          maxLength={80}
          placeholder="예: AI 실무 교육가, 성수동 카페 사장"
          className="mt-2 w-full rounded-xl bg-neutral-50 px-3 py-2 text-[13px] text-neutral-800 ring-1 ring-neutral-950/5 outline-none focus:ring-2 focus:ring-emerald-600"
        />
        <p className="mt-1 text-xs text-neutral-500">AI가 답글을 쓸 때 내가 누구인지 알고 쓰게 해요.</p>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={connect} disabled={busy || token.trim().length === 0} className="btn-accent px-4 py-2 text-sm">
            {busy ? "확인하는 중..." : "연결하기"}
          </button>
          <span className="text-xs text-neutral-500">스레드에 한 번 물어서 맞는 토큰인지 바로 확인해요.</span>
        </div>

        {result?.error ? (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-[13px] leading-relaxed text-rose-700">
            <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0" />
            {result.error}
          </p>
        ) : null}

        {result?.ok ? (
          <div className="mt-4 space-y-2">
            <p role="status" className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-[13px] font-medium text-emerald-800">
              <CheckCircleIcon className="size-4" />@{result.username} 연결됐어요
            </p>
            <p className="text-[13px] text-neutral-600">지금부터 내 지난 답글을 모아 말투를 익혀요. 몇 분 걸리고, 그동안 써도 괜찮아요.</p>
            <button onClick={onConnected} className="btn-accent px-4 py-2 text-sm">
              시작하기
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
