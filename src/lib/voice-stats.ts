// 답글 말투를 숫자로 잰다 (순수). 말투 만들기가 규칙책의 "0. 한눈에 보는 숫자"로 쓴다.
// 숫자 근거가 없으면 AI 가 버릇을 지어내서, 규칙책엔 여기서 잰 것만 싣는다.

const ENDINGS: [string, RegExp][] = [
  ["!!! 이상", /!{3,}\s*$/],
  ["!!", /(?<!!)!!\s*$/],
  ["! (하나)", /(?<!!)!\s*$/],
  ["..", /\.\.+\s*$|…\s*$/],
  [". (하나)", /(?<!\.)\.\s*$/],
  ["?", /\?\s*$/],
  ["ㅎㅎ", /ㅎ+\s*$/],
  ["ㅋㅋ", /ㅋ+\s*$/],
  ["~~", /~+\s*$/],
  ["이모지", /\p{Extended_Pictographic}\s*$/u],
  [":)", /:\s?\)\s*$/],
  ["요(맨끝)", /요\s*$/],
  ["다(맨끝)", /다\s*$/],
];

function endingOf(t: string): string {
  const s = t.trim();
  for (const [name, re] of ENDINGS) if (re.test(s)) return name;
  return "기타";
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

function top(counts: Map<string, number>, n: number): [string, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

export interface VoiceStats {
  replies: number;
  pairs: number;
  lenMedian: number;
  lenP90: number;
  /** 댓글 20자 이하 / 60자 초과일 때 내 답 길이 중앙값 */
  /** 재료가 없으면 null */
  shortCommentReply: number | null;
  longCommentReply: number | null;
  endings: [string, number][];
  firstWords: [string, number][];
  emojis: [string, number][];
  withEmoji: number;
  withBang: number;
  spacedBang: number;
  oneSentence: number;
  haeyo: number;
  hapnida: number;
}

const len = (t: string) => [...t].length;

export function measureVoice(texts: readonly string[], pairs: readonly { comment: string; reply: string }[]): VoiceStats {
  const all = texts.map((t) => t.trim()).filter(Boolean);
  const count = (re: RegExp) => all.filter((t) => re.test(t)).length;
  const endings = new Map<string, number>();
  const firsts = new Map<string, number>();
  const emojis = new Map<string, number>();
  for (const t of all) {
    endings.set(endingOf(t), (endings.get(endingOf(t)) ?? 0) + 1);
    const w = t.split(/\s+/)[0];
    if (w) firsts.set(w, (firsts.get(w) ?? 0) + 1);
    for (const e of t.match(/\p{Extended_Pictographic}/gu) ?? []) emojis.set(e, (emojis.get(e) ?? 0) + 1);
  }
  const shortC = pairs.filter((p) => len(p.comment) <= 20).map((p) => len(p.reply));
  const longC = pairs.filter((p) => len(p.comment) > 60).map((p) => len(p.reply));
  return {
    replies: all.length,
    pairs: pairs.length,
    lenMedian: quantile(all.map(len), 0.5),
    lenP90: quantile(all.map(len), 0.9),
    shortCommentReply: shortC.length ? quantile(shortC, 0.5) : null,
    longCommentReply: longC.length ? quantile(longC, 0.5) : null,
    endings: top(endings, 10),
    firstWords: top(firsts, 10),
    emojis: top(emojis, 8),
    withEmoji: count(/\p{Extended_Pictographic}/u),
    withBang: count(/!/),
    spacedBang: count(/\S \!/),
    oneSentence: all.filter((t) => t.split(/[.!?…]+\s+|\n+/).filter((s) => s.trim()).length <= 1).length,
    haeyo: count(/(요|용|여)[\s!.~ㅎㅋ?]*$/),
    hapnida: count(/(니다|니당)[\s!.~ㅎㅋ?]*$/),
  };
}

function pct(n: number, d: number): string {
  return d ? `${Math.round((100 * n) / d)}%` : "-";
}

export function formatVoiceStats(s: VoiceStats): string {
  const list = (xs: [string, number][]) => xs.map(([k, v]) => `${k} ${v}(${pct(v, s.replies)})`).join(" · ") || "없음";
  return [
    `- 재료: 내 답글 ${s.replies}개, 댓글과 짝지은 것 ${s.pairs}쌍`,
    `- 길이: 중앙값 ${s.lenMedian}자, 90%가 ${s.lenP90}자 안.${
      s.shortCommentReply !== null ? ` 짧은 댓글(20자 이하)엔 중앙값 ${s.shortCommentReply}자.` : ""
    }${s.longCommentReply !== null ? ` 긴 댓글(60자 초과)엔 ${s.longCommentReply}자.` : " 긴 댓글에 단 답글은 아직 재료가 없음."}`,
    `- 끝맺음: ${list(s.endings)}`,
    `- 첫 단어: ${s.firstWords.map(([k, v]) => `"${k}" ${v}`).join(" · ") || "없음"}`,
    `- 이모지: 답글 ${s.withEmoji}개(${pct(s.withEmoji, s.replies)})에 있음. 자주 쓰는 것: ${s.emojis.map(([k, v]) => `${k} ${v}`).join(" · ") || "없음"}`,
    `- 느낌표: 답글 ${s.withBang}개에 있음, 그중 앞을 띄운 것(\"요 !\") ${s.spacedBang}개`,
    `- 한 문장 답글 ${pct(s.oneSentence, s.replies)} · 해요체 끝 ${s.haeyo}개 · 합니다체 끝 ${s.hapnida}개`,
  ].join("\n");
}
