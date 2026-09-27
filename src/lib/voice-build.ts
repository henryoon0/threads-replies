// 말투 만들기 — 내가 남의 댓글에 직접 단 답글을 모아 규칙책(threads-reply-style.md)과
// 예시 풀(voice-pairs.json)을 만든다. 초안기는 이 둘로 "내가 쓴 것 같은" 답글을 쓴다.
//
//   1. /me/replies 로 내 답글을 모은다 (최대 1,000개)
//   2. 답글마다 원댓글을 불러와 (댓글, 내 답글) 쌍을 만든다 (최대 300쌍)
//   3. 길이·끝맺음·이모지·첫 단어를 잰다
//   4. 숫자 + 상황별 실제 예시를 Claude 에 주고 같은 틀의 규칙책을 쓰게 한다
//
// fire-and-forget: 단계마다 진행을 파일에 쓰고(화면이 읽는다), 앱이 꺼져 끊기면 다음 조회 때
// 처음부터 다시 돈다(멱등 — 결과 파일을 통째로 다시 쓴다).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { graphFetch, THREADS_GRAPH_BASE, resolveAccessToken } from "@/lib/threads-archive/graph";
import { runClaudeCLI } from "@/lib/ai/claude-cli";
import { readProfile, ownerLine } from "@/lib/profile";
import { styleBookPath, threadsRepliesDataDir, toVoiceExamples, SITUATION_LABEL, type ReplySituation } from "@/lib/threads-replies/voice";
import { measureVoice, formatVoiceStats, type VoiceStats } from "./voice-stats";

const MAX_REPLIES = 1000;
const MAX_PAIRS = 300;
const MIN_REPLIES = 20;
const EXAMPLES_PER_SITUATION = 12;
const BOOK_TIMEOUT_MS = 6 * 60_000;
/** 이보다 오래 "도는 중"이면 앱이 꺼져 끊긴 것으로 본다 */
const STALE_MS = 15 * 60_000;

export type VoiceBuildState = "idle" | "collecting" | "pairing" | "writing" | "done" | "failed";

export interface VoiceBuildJob {
  state: VoiceBuildState;
  updatedAt: string;
  replies?: number;
  pairs?: number;
  error?: string;
  /** 답글이 적어 기본 규칙책을 쓴 경우 */
  starter?: boolean;
}

function jobPath(): string {
  return path.join(threadsRepliesDataDir(), "voice-job.json");
}

export async function readVoiceJob(): Promise<VoiceBuildJob> {
  try {
    return JSON.parse(await readFile(jobPath(), "utf8")) as VoiceBuildJob;
  } catch {
    return { state: "idle", updatedAt: new Date(0).toISOString() };
  }
}

async function patchJob(patch: Partial<VoiceBuildJob>): Promise<void> {
  const next = { ...(await readVoiceJob()), ...patch, updatedAt: new Date().toISOString() };
  await mkdir(path.dirname(jobPath()), { recursive: true });
  await writeFile(jobPath(), JSON.stringify(next, null, 2));
}

function isRunning(job: VoiceBuildJob): boolean {
  return ["collecting", "pairing", "writing"].includes(job.state) && Date.now() - Date.parse(job.updatedAt) < STALE_MS;
}

const g = globalThis as typeof globalThis & { __voiceBuildRunning?: boolean };

/** 이미 도는 중이면 무시한다 (같은 프로세스·끊기지 않은 잡) */
export function startVoiceBuild(): void {
  if (g.__voiceBuildRunning) return;
  g.__voiceBuildRunning = true;
  void runVoiceBuild()
    .catch(async (e) => {
      await patchJob({ state: "failed", error: e instanceof Error ? e.message : String(e) });
    })
    .finally(() => {
      g.__voiceBuildRunning = false;
    });
}

/** 화면이 부르는 상태 조회. 끊긴 잡이면 다시 띄운다. */
export async function voiceStatus(): Promise<VoiceBuildJob> {
  const job = await readVoiceJob();
  const interrupted = ["collecting", "pairing", "writing"].includes(job.state) && !isRunning(job);
  if (interrupted && !g.__voiceBuildRunning) startVoiceBuild();
  return job;
}

interface RawReply {
  id: string;
  text?: string;
  timestamp?: string;
  username?: string;
  replied_to?: { id: string };
  root_post?: { id: string };
}

async function collectReplies(token: string, me: string): Promise<RawReply[]> {
  const out: RawReply[] = [];
  let url: string | null =
    `${THREADS_GRAPH_BASE}/me/replies?fields=id,text,timestamp,username,replied_to,root_post&limit=100&access_token=${encodeURIComponent(token)}`;
  while (url && out.length < MAX_REPLIES) {
    const page = (await graphFetch(url)) as { data?: RawReply[]; paging?: { next?: string } };
    for (const r of page.data ?? []) {
      // 내 글 본문의 연결 칸(스레드 2번째 칸 등)도 "답글"로 온다. 남의 댓글에 단 것만 쓴다 — 짝짓기에서 거른다.
      if (r.text?.trim() && (!r.username || r.username === me)) out.push(r);
    }
    url = page.paging?.next ?? null;
  }
  return out.slice(0, MAX_REPLIES);
}

async function pairWithComments(token: string, me: string, replies: RawReply[]) {
  const pairs: { comment: string; commenter: string; reply: string; at: string; root: string }[] = [];
  const queue = replies.filter((r) => r.replied_to?.id);
  let i = 0;
  const worker = async () => {
    while (i < queue.length && pairs.length < MAX_PAIRS) {
      const r = queue[i++];
      try {
        const parent = (await graphFetch(
          `${THREADS_GRAPH_BASE}/${r.replied_to!.id}?fields=text,username&access_token=${encodeURIComponent(token)}`
        )) as { text?: string; username?: string };
        if (!parent.text?.trim() || parent.username === me) continue; // 내 글에 이은 칸은 답글이 아니다
        pairs.push({
          comment: parent.text,
          commenter: parent.username ?? "",
          reply: r.text ?? "",
          at: r.timestamp ?? "",
          root: r.root_post?.id ?? "",
        });
      } catch {
        // 지워진 댓글 등 — 건너뛴다
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return pairs;
}

async function writeData(file: string, value: unknown): Promise<void> {
  const full = path.join(threadsRepliesDataDir(), file);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify(value, null, 2));
}

async function runVoiceBuild(): Promise<void> {
  await patchJob({ state: "collecting", error: undefined, starter: undefined });
  const [token, profile] = await Promise.all([resolveAccessToken(), readProfile()]);
  const me = profile.username;
  const replies = await collectReplies(token, me);
  await writeData("voice-replies.json", replies.map((r) => ({ text: r.text, timestamp: r.timestamp })));

  await patchJob({ state: "pairing", replies: replies.length });
  const pairs = await pairWithComments(token, me, replies);
  await writeData("voice-pairs.json", pairs);

  await patchJob({ state: "writing", pairs: pairs.length });
  const texts = replies.map((r) => r.text ?? "");
  const stats = measureVoice(texts, pairs);
  const starter = replies.length < MIN_REPLIES;
  const book = starter ? starterBook(ownerLine(profile), stats) : await writeBook(ownerLine(profile), stats, pairs);
  await mkdir(path.dirname(styleBookPath()), { recursive: true });
  await writeFile(styleBookPath(), book);
  await patchJob({ state: "done", starter });
}

function examplesBySituation(pairs: { comment: string; reply: string; at: string }[]): string {
  const pool = toVoiceExamples(pairs);
  const by = new Map<ReplySituation, typeof pool>();
  for (const e of pool) by.set(e.situation, [...(by.get(e.situation) ?? []), e]);
  return [...by.entries()]
    .map(([s, list]) => {
      const lines = list
        .slice(0, EXAMPLES_PER_SITUATION)
        .map((e) => `- 댓글: ${e.comment.replace(/\s+/g, " ").slice(0, 160)}\n  내 답글: ${e.reply.replace(/\n/g, " ")}`);
      return `### ${SITUATION_LABEL[s]} (${list.length}쌍)\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

const BOOK_SKELETON = `# 스레드 답글 말투 규칙책

(근거 한 줄: 답글 몇 개, 짝 몇 쌍으로 잰 것인지)

## 0. 한눈에 보는 숫자
## 1. 공통 말투
## 2. 상황별 규칙
### 2-1. 감사/칭찬 반응
### 2-2. 질문(사실 답)
### 2-3. 질문(모르는 것·단정 못 하는 것)
### 2-4. 대화 이어가기
### 2-5. 농담
### 2-6. 신청·구매 문의
### 2-7. 추천/정보 공유
## 3. 근거를 담을 때
## 4. 실측상 한 번도 없는 것`;

async function writeBook(owner: string, stats: VoiceStats, pairs: { comment: string; reply: string; at: string }[]): Promise<string> {
  const prompt = `${owner} 주인이 남의 댓글에 직접 단 답글을 재서, 답글 초안을 쓰는 AI 가 읽을 "말투 규칙책"을 만든다.

<measured>
${formatVoiceStats(stats)}
</measured>

<real_pairs>
${examplesBySituation(pairs)}
</real_pairs>

아래 틀을 그대로 쓰고, 각 절을 채운다.
${BOOK_SKELETON}

규칙:
- 숫자는 <measured> 에 있는 것만 쓴다. 없는 숫자를 지어내지 않는다.
- 규칙마다 <real_pairs> 의 실제 답글을 1~3개 따옴표로 붙인다. 예시는 고치지 않고 그대로 옮긴다.
- 예시가 없는 상황 절은 "아직 예시가 없다. 가까운 상황(…)을 따른다" 한 줄만 쓴다.
- "4. 실측상 한 번도 없는 것"은 답글 전체에서 0번 나온 표현만 쓴다(예: 특정 이모지, "여러분", 마침표 설명체 등). 확인 못 한 건 쓰지 않는다.
- 주인을 이름으로 부르지 않고 "주인"이라고 쓴다.
- 마크다운 문서 하나만 출력한다. 설명·코드펜스 없이.`;
  const out = await runClaudeCLI(prompt, { effort: "medium", timeoutMs: BOOK_TIMEOUT_MS, requireClaude: false });
  return out.trim().replace(/^```(?:markdown)?\n|\n```$/g, "") + "\n";
}

/** 답글이 적은 사람용 — 숫자만 싣고, 나머지는 예시를 따르라는 기본 규칙책 */
function starterBook(owner: string, stats: VoiceStats): string {
  return `# 스레드 답글 말투 규칙책 (기본)

${owner} 주인의 답글이 아직 ${stats.replies}개뿐이라 기본 규칙으로 시작한다. 답글이 ${MIN_REPLIES}개를 넘으면 [말투 다시 만들기]로 규칙책을 새로 만든다.

## 0. 한눈에 보는 숫자
${formatVoiceStats(stats)}

## 1. 공통 말투
- 답글은 글이 아니라 대화다. 한두 문장으로, 댓글이 말한 것에 바로 반응한다.
- 상대 댓글에서 그 사람만 쓴 말 하나를 받아서 반응한다.
- 상대가 짧게 쓰면 짧게, 길게 쓰면 조금 더 길게 답한다.
- 예시 답글이 있으면 규칙보다 예시를 따른다.

## 2. 상황별 규칙
- 질문엔 아는 것만 사실로 답하고, 모르면 모른다고 짧게 말한다.
- 감사·칭찬엔 짧게 고마움을 돌려준다.

## 3. 근거를 담을 때
- 근거에서 가져온 사실도 말하듯 옮긴다("~더라고요", "~해봤는데").
`;
}
