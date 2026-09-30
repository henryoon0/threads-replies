"use client";

// 토큰이 없을 때 완성된 화면 위에 뜨는 팝업. 받는 사람이 이미 메타 앱을 만든 경우가 많아서
// 기존 앱에서 토큰 뽑는 3단계만 먼저 보여주고, 앱이 없을 때의 전체 순서는 접어 둔다.
import { useState } from "react";
import { ArrowTopRightOnSquareIcon, ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { STEPS } from "./setup-guide";

const QUICK: { title: string; body: React.ReactNode }[] = [
  {
    title: "내 메타 앱을 열어요",
    body: <>이미 만든 앱을 누르고 <b>사용 사례 &gt; Threads API 액세스</b>로 들어가요.</>,
  },
  {
    title: "권한 5개가 있는지 봐요",
    body: (
      <>
        <b>맞춤 설정</b>에 <code>threads_basic</code>, <code>threads_read_replies</code>, <code>threads_manage_replies</code>,{" "}
        <code>threads_content_publish</code>, <code>threads_manage_insights</code>가 있어야 해요. 빠졌으면 토큰을 만들기 전에 추가해요.
      </>
    ),
  },
  {
    title: "토큰을 새로 만들어 복사해요",
    body: (
      <>
        <b>설정</b> 맨 아래 <b>User Token Generator</b>에서 내 아이디 옆 <b>Generate Access Token</b>을 누르고 긴 글자를 전부 복사해요.
        예전 토큰은 다시 볼 수 없어서 새로 만들면 돼요.
      </>
    ),
  },
];

export function TokenModal({ onConnected, onClose, tried }: { onConnected: () => void; onClose: () => void; tried?: number }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, intro: "" }),
      });
      const body = (await res.json()) as { error?: string };
      if (res.ok) onConnected();
      else setError(body.error ?? "연결하지 못했어요.");
    } catch {
      setError("앱 서버에 닿지 못했어요. 앱이 켜져 있는지 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-950/30 p-6 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="token-title" className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-card ring-1 ring-neutral-950/5">
        <button onClick={onClose} aria-label="나중에" className="absolute right-4 top-4 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
          <XMarkIcon className="size-4" />
        </button>
        <h2 id="token-title" className="text-lg font-semibold text-neutral-900">스레드 토큰을 넣어 주세요</h2>
        <p className="mt-1 break-keep text-[13px] leading-relaxed text-neutral-500">
          토큰을 넣으면 새 댓글을 받아오고 답을 바로 보낼 수 있어요. 토큰은 이 컴퓨터에만 저장돼요.
        </p>
        <p className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-[12.5px] leading-relaxed text-neutral-600">
          {tried
            ? `이 컴퓨터에서 토큰 ${tried}개를 찾았지만 만료됐거나 박약사 계정 것이 아니었어요. 새로 만들어 주세요.`
            : "이 컴퓨터에서 저장된 토큰을 찾아봤지만 없었어요. 아래 순서로 새로 만들어 주세요."}
        </p>

        <ol className="mt-4 space-y-2.5">
          {QUICK.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold tabular-nums text-emerald-700">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-neutral-900">{s.title}</p>
                <p className="mt-0.5 break-keep text-[12.5px] leading-relaxed text-neutral-600">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <a
          href="https://developers.facebook.com/apps/"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-emerald-700 hover:text-emerald-800"
        >
          내 메타 앱 목록 열기 <ArrowTopRightOnSquareIcon className="size-3.5" />
        </a>

        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          aria-label="토큰"
          placeholder="복사한 토큰을 여기에 붙여넣어요 (TH로 시작하는 긴 글자)"
          className="mt-4 w-full resize-none rounded-xl bg-neutral-50 p-3 font-mono text-xs text-neutral-800 ring-1 ring-neutral-950/5 outline-none focus:ring-2 focus:ring-emerald-600"
        />
        {error ? (
          <p role="alert" className="mt-2 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-[13px] leading-relaxed text-rose-700">
            <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}
        <div className="mt-3 flex items-center gap-3">
          <button onClick={connect} disabled={busy || token.trim().length === 0} className="btn-accent px-4 py-2 text-sm">
            {busy ? "확인하는 중..." : "연결하기"}
          </button>
          <button onClick={onClose} className="text-[13px] text-neutral-500 hover:text-neutral-800">
            나중에
          </button>
        </div>

        <details className="mt-5 text-[12.5px] text-neutral-600">
          <summary className="cursor-pointer text-neutral-500 hover:text-neutral-800">메타 앱이 아직 없다면 (전체 순서)</summary>
          <ol className="mt-2 space-y-2">
            {STEPS.map((s, i) => (
              <li key={s.title} className="break-keep leading-relaxed">
                <b className="text-neutral-800">
                  {i + 1}. {s.title}
                </b>
                <br />
                {s.body}
                {s.link ? (
                  <>
                    {" "}
                    <a href={s.link.href} target="_blank" rel="noreferrer" className="font-medium text-emerald-700">
                      {s.link.label}
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </div>
  );
}
