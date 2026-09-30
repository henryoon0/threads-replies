// Shared, client-safe types + labels for the content-ideas feature. No Node
// imports here, so both the page (client) and the server libs can use it.
//
// Today this only generates Threads ideas. Instagram / YouTube / blog are
// listed as platforms so the UI can show them as "coming soon" and so adding
// them later is just flipping `ready` and writing a generator.

import type { RoundupIdeaMeta } from "@/lib/roundup-view";

export type Platform = "threads" | "instagram" | "youtube" | "blog";

export interface PlatformOption {
  id: Platform;
  label: string;
  ready: boolean; // false → shown in the UI but not yet generatable
}

export const PLATFORMS: PlatformOption[] = [
  { id: "threads", label: "스레드", ready: true },
  { id: "instagram", label: "인스타그램", ready: false },
  { id: "youtube", label: "유튜브", ready: false },
  { id: "blog", label: "블로그", ready: false },
];

// One idea = one Threads thread (a hook → body → close run of connected posts).
// A single "generate" run converts a 소재 into one such thread. `type` is the
// 결(style) the draft was written in, and doubles as the board label.
//
// 09-26: henry 최근 발행 글 30편에서 뽑은 다섯 스타일로 시안을 바꿨다(henry 선택:
// "5가지를 모두 반영"). 은퇴한 결(case·storytelling)은 IDEA_TYPES에 남겨 기존 카드가
// 제 라벨로 보이게 하고, 새 생성은 ACTIVE_IDEA_TYPES 만 돈다. info·curation 은 키를
// 그대로 쓰고 결만 선언·한다체 / 번호형 정리로 바꿨다.
export const IDEA_TYPES = [
  "reaction",
  "recommend",
  "essay",
  "info",
  "curation",
  "case",
  "storytelling",
] as const;
export type IdeaType = (typeof IDEA_TYPES)[number];

/** 지금 생성하는 시안 5벌. 순서가 곧 보드의 시안 1~5 순서다. */
export const ACTIVE_IDEA_TYPES = ["reaction", "recommend", "essay", "info", "curation"] as const;

export const IDEA_TYPE_LABEL: Record<IdeaType, string> = {
  reaction: "짧은 반응",
  recommend: "추천·도구",
  essay: "개인 서사",
  info: "선언·한다체",
  curation: "번호형 정리",
  case: "실무 적용", // 은퇴 (09-26). 기존 카드 표시용으로만 남는다.
  storytelling: "스토리텔링", // 은퇴 (09-05). 기존 카드 표시용으로만 남는다.
};

// ── 후킹 계열 SSOT (07-15, "+다른 후킹" 확장) ────────────────────────────────
// threads-prompt.md의 후킹 계열을 코드가 고를 수 있게 옮긴 것. "+다른 후킹"이
// 이 풀에서 아직 안 쓴 계열을 뽑아 첫 문장을 강제한다. 순서가 곧 선호 순위다
// (앞 3개 = henry가 07-14 하사비스 20안 비교에서 직접 고른 1순위 계열).
// directive는 생성 프롬프트에 지시사항과 같은 우선순위로 주입된다.
export const HOOK_FAMILIES = [
  {
    id: "number-twist",
    label: "숫자 반전",
    hint: "구체 숫자 속 의외성으로",
    directive:
      '첫 문장을 검증된 구체 숫자로 열되, 그 숫자 안에 의외성(반전)이 있어야 한다. 예: "북마크가 좋아요보다 많은 글은 드뭅니다. 좋아요 6,300에 북마크 7,100." 반전 없는 지표 나열은 금지.',
  },
  {
    id: "stamp-twist",
    label: "시점 스탬프 반전",
    hint: "따끈함 + 예상 밖 사실로",
    directive:
      '첫 문장에 이 소재가 얼마나 따끈한지(오늘, 몇 시간 전) 시점을 박고, 바로 이어 예상을 뒤집는 사실 하나를 붙인다. 예: "오늘 올라온 글인데 반나절 만에 조회 92만을 넘겼습니다." 시점만 있고 반전이 없으면 실패다.',
  },
  {
    id: "authority-twist",
    label: "권위 반전",
    hint: "권위자의 예상 밖 행동으로",
    directive:
      '권위 있는 인물이나 기관이 통념과 반대로 움직인 사실을 첫 문장에 놓는다. 예: "노벨상 수상자가 자기 업계의 속도를 늦출 수도 있어야 한다고 썼습니다."',
  },
  {
    id: "question",
    label: "질문",
    hint: "독자의 진짜 궁금증으로",
    directive:
      '독자가 실제로 품을 법한 궁금증을 질문 한 문장으로 던지고 본문이 그 답을 준다. 예: "AI를 만드는 회사 CEO가 왜 규제를 만들어달라고 할까요?" 낚시성 질문 금지.',
  },
  {
    id: "quote",
    label: "핵심 문장 인용",
    hint: "원문의 가장 강한 문장으로",
    directive:
      "원문에서 가장 강한 문장 하나를 한국어로 옮겨 따옴표째 첫 줄에 놓고, 누가 한 말인지 바로 다음 문장에서 밝힌다. 인용은 원문에 실제로 있는 문장만.",
  },
  {
    id: "audience",
    label: "청중 지목",
    hint: "딱 그 사람을 불러 세워서",
    directive:
      '이 글이 특히 필요한 독자를 첫 문장에서 구체적으로 지목한다. 예: "토큰 한도 때문에 속 터져본 분들은 이거 꼭 보세요." 두루뭉술한 "직장인 여러분" 말고 상황으로 좁혀서.',
  },
  {
    id: "exclaim",
    label: "감탄 반응",
    hint: "진짜 감탄이 나올 때만",
    directive:
      '소재가 실제로 놀라울 때만, henry의 첫 반응을 그대로 첫 문장에 쓴다. 예: "와.. 이건 그대로 따라만 해도 토큰이 굳습니다." 과장 금지 — 소재가 이 정도가 아니면 이 계열을 쓰지 마라.',
  },
  {
    id: "murmur",
    label: "자문 중얼거림",
    hint: "혼잣말처럼 낮게",
    directive:
      '혼잣말 같은 낮은 톤의 중얼거림으로 연다. 예: "이거 공짜로 봐도 되나 싶은 글이 올라왔습니다." 감탄사 없이 담담하게.',
  },
  {
    id: "overseas",
    label: "해외 화제",
    hint: "해외 반응을 다리로",
    directive:
      '해외에서 실제로 화제가 된 정황(조회수, 인용, 커뮤니티 반응)을 첫 문장에 놓는다. 예: "해외에선 엄청난 관심을 받고 있는 깃허브입니다." 정황은 검증된 것만.',
  },
  {
    id: "maker-trust",
    label: "제작자 신뢰",
    hint: "만든 사람이 직접",
    directive:
      '만든 사람, 그 일을 실제로 하는 당사자가 직접 말했다는 사실을 첫 문장에 놓는다. 예: "도구를 만든 사람이 직접 쓰는 법을 공개했습니다."',
  },
  {
    id: "regret",
    label: "아까움 호소",
    hint: "혼자 알기 아까워서",
    directive:
      '이 소재를 혼자 알기 아깝다는 정서로 연다. 예: "혼자 알기 아까운 내용입니다." 뒤 문장에서 왜 아까운지 구체 근거가 바로 따라와야 한다.',
  },
  {
    id: "reveal",
    label: "반전 예고",
    hint: "본인도 몰랐던 사실로",
    directive:
      '당사자조차 예상 못 한 결과나 인정을 첫 문장에 예고한다. 예: "본인도 예상 못 했다고 인정했습니다." 예고한 반전은 본문 초반에 바로 회수한다.',
  },
] as const;

export type HookFamilyId = (typeof HOOK_FAMILIES)[number]["id"];
export type HookFamily = (typeof HOOK_FAMILIES)[number];

export const HOOK_FAMILY_BY_ID: Record<string, HookFamily> = Object.fromEntries(
  HOOK_FAMILIES.map((f) => [f.id, f])
);

// ── 관점 SSOT (07-16, henry 확정: "여러 개 뽑는 핵심은 다양한 관점으로 내
//    스타일의 글을 보는 것") ──────────────────────────────────────────────────
// 시안 여러 벌의 진짜 목적은 포장(길이·말투)을 바꿔 보는 게 아니라, **같은 소재를
// 다른 각도에서 해석한** 글을 나란히 보는 것이다. 그래서 시안을 가르는 축은
// "무엇을 보느냐"(관점)다. 각 관점은 **몸통을 어떤 각도로 해석·전개하는지**를
// 정한다. 오프너(1칸 첫 줄)는 관점이 정하지 않는다 — henry가 자주 쓰는 시그니처
// 표현("와..", 짧은 반말 평가, "나만 알고 싶다" 등)으로 열되 시안마다 다르게
// (rewriteThreadInPerspective 의 공용 오프너 지침 + 회피 목록).
//
// ⚠분량은 관점이 아니라 소재가 정한다 (henry 07-15: "긴 글이 국룰"). 1칸짜리가
// 필요하면 henry 가 컴포저의 "하나의 단락"(GenerationMode "single") 토글로 요청한다.
// 시안 2(실무 적용)의 마지막 칸 규칙. 2026-08-19엔 "숫자 회수 → 인물 회수 → 장면 →
// 판별 기준" 4단이었지만 발행에 한 번도 쓰이지 않았고, 초안이 "~를 보면 압니다"
// 판정문으로 끝나 해볼 게 없었다(09-24 진단: 시안 2 스레드 86개 중 "~세요" 마무리 10개).
// 2026-09-24 henry 결정: 프롬프트·데모는 글 안에서 완성하지 않고, 마지막 칸에서
// "henry가 이걸로 먼저 해볼 일"로 연결해 제안한다. 강의 사례는 쓰지 않는다.
const PRACTICAL_CLOSING = `마지막 칸 (닫는 방법, henry 확정 2026-09-24):
1. **저라면 무엇부터 해볼지**: henry가 이 소재로 자기 일(콘텐츠 제작, 자료 수집, 메일·일정
   정리, 대시보드 같은 개인 도구)에서 무엇부터 붙여볼지 "저라면 ~부터 해보겠습니다"로
   한 문장. 계획이지 경험이 아니므로 지어낸 경험이 아니다. 강의·수강생 이야기는 쓰지 않는다.
2. **다음 한 걸음**: 독자가 따라 할 첫 행동 하나를 무엇을·어디에·어느 일에로 구체적으로.
   소재에 프롬프트·명령어·데모가 있으면 여기서 이름으로 가리켜 "이것부터 돌려보세요"로
   연결한다. 프롬프트 전문을 옮겨 적거나 글 안에서 시연을 완성하지 않는다.

⚠두 단계는 마지막 한 칸 안에서 끝냅니다. 이 칸의 권유 한 줄은 훈계가 아니라 허용된 마무리입니다.

금지: cc. 출처 표기(출처는 맨 끝 링크 줄로 충분합니다), 다짐·격려·인사 클로징,
여기서 처음 꺼내는 새 사실.`;

export const PERSPECTIVES = [
  {
    id: "practical",
    label: "실무 적용",
    hint: "내 일에 어디가 걸리나",
    directive: `이 소재를 **"직장인 실무자의 일에 어디가 걸리나"** 각도로 해석한다. 소재 안에서 실무에 걸리는 대목을 골라 칸의 축으로 세우고, 그 대목이 어떤 업무 장면에서 어떻게 드러나는지까지 끌고 간다.

⚠**이 시안은 조언글이 아니라 관찰글이다.** (henry 08-18 지적: "실무 적용 시안은 손이 안 간다". 실측해보니 칸마다 "~하세요"로 닫는 자기계발 강사 말투였다.) 다음 네 가지는 어기면 실패다.
- **본문 칸을 명령형으로 닫지 않는다.** 권유는 마지막 칸의 다음 한 걸음 1개뿐이다. 본문 칸은 관찰과 판단의 서술로 쓴다.
- **"여러분"은 글 전체에서 1번까지.** 칸의 주어는 독자가 아니라 구체적인 업무 장면이다. 장면은 소재가 실제로 다루는 일에서 가져온다. 소재와 무관한 사무 장면을 끼워 넣지 않는다.
- **소재를 지워도 성립하는 조언은 금지.** "파일 이름을 정리하세요", "프롬프트를 쪼개세요" 같은 일반론은 아무 뉴스에나 붙는다. 적용점마다 소재의 구체적 사실(기능 이름·인용·수치·설계 결정) 하나를 근거로 물고 있어야 한다.
- **사실을 덜어내지 않는다.** 원안이 담은 사실 중 실무에 걸리는 것은 전부 살리되, 배치를 실무 순서로 다시 짠다. **검사 기준: 글자 수는 원안의 90% 이상, 칸 수는 원안의 80% 이상.** 이 밑으로 내려가면 실패다(실측: 81%로 나왔을 때 원문 항목 하나가 통째로 빠졌다). 그러면 henry가 원안을 두고 이 시안을 고를 이유가 없다. 단 분량을 채우려고 같은 말을 늘리는 것도 실패다. 빠진 사실을 되살려 채운다.

전개 뼈대: 뉴스 요약 단락을 따로 두지 않는다. 1칸은 실무자가 이미 겪고 있는 장면 하나로 열고, 바뀐 사실은 각 적용점을 설명하는 문장 안에 조각으로 녹인다. 지어낸 henry 경험담("써봤더니")은 금지. 대신 "저라면 이걸 ~에 붙여보겠습니다" 같은 henry의 계획 문장을 글 전체에서 최소 1번 쓴다. 계획은 경험이 아니라서 날조가 아니다.

**1칸 안의 순서** (2026-08-30, 발행 글 30편 실측): 첫 줄(독립 한 문단) → 무슨 소식인지 한 문단("~했는데요"로 소개, 사실은 1~2개까지) → 실무에 걸리는 대목 한 겹. 첫 칸에 통계·인명·소속을 몰아넣지 않는다. 결과 수치는 2칸 이후에서 처음 꺼낸다.

**판단의 밀도와 결** (2026-08-30 실측 교정): 모든 칸을 "사실 → 업무 번역"으로 닫지 않는다. 그렇게 닫으면 공식으로 읽히고 판단의 값이 같이 떨어진다(직전 실측: 11칸 중 10칸이 같은 공식이었다).
- 업무 장면으로 닫는 칸은 **다섯 개까지**. 나머지는 사실만 충분히 풀고 다음 칸으로 넘긴다 (사실로만 닫는 칸이 최소 세 개는 있어야 한다).
- 닫는 칸끼리도 결이 달라야 한다. 통념을 뒤집는 칸, 독자가 이미 겪은 장면을 확인시키는 칸, 소재에 근거가 있을 때만 범위를 가르는 칸(글 전체 1회까지)을 섞는다. 같은 방향의 결론이 세 번 반복되면 실패다.
- 판단은 원리까지 내려간다. "그래서 당신 업무에선 이렇습니다"로 옮기기만 하면 번역이지 인사이트가 아니다. 왜 그렇게 되는지가 한 문장으로 서야 한다.

**이름과 개념어는 아낀다**: 사람 이름은 글 전체에서 2회까지, 소속으로 대신할 수 있으면 소속으로 쓴다("MIT에서 나온 실험"). 미들네임·직함·팀 구성("대학원생 두 명과 함께")은 뺀다. 학술 용어는 이름을 앞세우지 말고 현상을 먼저 풀어 쓴 뒤 필요할 때만 한 번 붙인다.
${PRACTICAL_CLOSING}`,
  },
  {
    id: "explainer",
    label: "차근차근 해설",
    hint: "논점을 차례로, 판단은 다섯 곳에",
    directive: `이 소재를 **"논점을 순서대로 풀고, 원리가 드러나는 논점 다섯 곳에만 판단을 얹는"** 해설로 쓴다. Andrew Ng 이 편지에서 쓰는 방식이다. 감상·감탄과 다르고, 판단을 얹는 칸에서는 "왜 그렇게 되는지"까지 원리로 내려간다.
전개 뼈대:
- 1칸: 첫 줄은 스펙의 후킹 계열로 연다(과장·낚시 금지). "이 글은 ~를 다룹니다" 식 예고로 열지 않는다.
- 2칸: 소재가 고른 말·개념·틀 하나를 뜯어 설명한다. 왜 하필 이 단어로 말했는지, 그 단어가 무엇을 가르는지. (예: "하필 '마감 시간'에 빗댄 이유")
- 중간 칸들: 소재의 논점을 원문 순서대로 하나씩. 한 칸 = 한 논점. 판단 문장으로 닫는 칸은 글 전체에서 **다섯 개까지**이고, 나머지 칸은 설명을 충분히 풀고 판단 없이 다음 칸으로 넘긴다(작성 지침의 인사이트 밀도 규칙과 같은 기준이다).
- 끝에서 두 번째 칸: 소재에 근거가 있으면 범위를 가르거나 반론을 한 줄 붙인다. 근거가 없으면 이 칸도 논점 설명으로 쓴다.
- 마지막 칸: "저라면 ~부터 해보겠습니다" 한 문장 + 독자가 오늘·내일 해볼 다음 한 걸음 하나(무엇을·어디에). 소재에 프롬프트·데모가 있으면 그걸 가리켜 연결만 하고, 글 안에서 완성하지 않는다. 추상적 전망이나 다짐으로 닫지 않는다.
금지: 근거 없는 미래 단정("판이 완전히 바뀝니다"), 감정적 감탄, 소재에 없는 수치. 인용은 짧게 1~2회.`,
  },
  {
    id: "market",
    label: "업계 판도",
    hint: "AI 시장 판이 어떻게 흔들리나",
    directive: `이 소재가 **"AI 업계·시장의 판을 어떻게 흔드나"** 각도로 해석한다. 회사·제품·경쟁 구도가 어떻게 갈리는지를 축으로 전개한다. 누가 유리해지고 누가 불리해지나, 무슨 새 경쟁이 생기나, 판의 규칙이 어떻게 바뀌나. 시장 함의가 축이고 나머지는 그걸 받치는 근거로.
전개 뼈대: 무슨 일이 있었는지 요약은 최대 1~2문장으로 끝내고, 곧장 승자·패자·새 경쟁의 대진표로 들어간다. 칸의 주어를 회사 이름(경쟁사 포함)으로 세우고, 칸마다 다른 플레이어를 다룬다.`,
  },
  {
    id: "intent",
    label: "당사자 속내",
    hint: "만든 사람이 왜 굳이 이렇게",
    directive: `**"이걸 내놓은 사람·회사가 왜 굳이 이렇게 움직였나"** 각도로 해석한다. 발화자의 동기·입장·속내를 소재 안의 근거(직접 인정한 말, 드러낸 태도, 정황)에서 추론한다. 심리·의도 해석이 축이다. ⚠지어낸 속마음 금지 — 소재에 실제로 있는 발언·정황에서만 읽고, 추론은 "~로 보인다"처럼 톤을 낮춘다.
전개 뼈대: 소재 속 실제 발언·표현을 인용으로 앞세우고, 그 말을 뜯어보는 방식으로 전개한다. "공식 설명은 이런데, 정황을 보면 이렇게 읽힌다"의 리듬. 사실 요약 단락을 따로 두지 말고 해석에 필요한 사실만 곁들인다.`,
  },
  {
    id: "risk",
    label: "리스크·우려",
    hint: "위험만 곧이곧대로 보면",
    directive: `낙관은 접어두고 **"위험·한계·우려"** 각도로만 해석한다. 소재 안의 위험 요소·빈틈·반론·놓친 지점을 축으로 전개하고, 실무자·의사결정자가 조심할 지점으로 닿게 한다. 없는 위험을 지어내지 말고, 소재에 실제로 있거나 소재에서 합리적으로 따라오는 우려만.
전개 뼈대: 소식의 좋아 보이는 면을 한 문장으로 인정한 뒤 바로 "그런데"로 꺾는다. 이후 칸은 우려 하나씩, 우려가 현실이 되면 누가 어떻게 다치는지까지 끌고 간다. 사실 요약 단락은 두지 않는다.`,
  },
  {
    id: "opportunity",
    label: "기회·낙관",
    hint: "이걸 기회로 읽으면",
    directive: `**"이걸 기회로 읽으면 뭐가 보이나"** 각도로 해석한다. 소재 안의 가능성·상방·베팅할 지점·새로 열리는 문을 축으로 전개한다. 어디에 시야를 넓히면 좋을지로 닫는다. 근거 없는 장밋빛 과장은 금지 — 소재에 있는 실제 가능성에서만.
전개 뼈대: "이 변화로 새로 열리는 문"을 칸마다 하나씩 세운다. 누구에게, 언제부터, 어떤 문이 열리나. 사실 요약 단락은 두지 말고 각 기회를 설명하는 데 필요한 사실만 그 자리에서 꺼낸다.`,
  },
] as const;

export type PerspectiveId = (typeof PERSPECTIVES)[number]["id"];
export type Perspective = (typeof PERSPECTIVES)[number];

export const PERSPECTIVE_BY_ID: Record<string, Perspective> = Object.fromEntries(
  PERSPECTIVES.map((p) => [p.id, p])
);

// How a 소재 is rendered into a thread.
//   "thread" — the default: 후크 → 본문 → 마무리 multi-칸 run (칸 수는 분량 비례).
//   "single" — one 칸 only: a key-points summary (출처 + 핵심 2~4줄 + 행동유도),
//              the shape used to distill a video/대본 into a single promo post.
// The output type is identical either way (posts: string[]); "single" just means
// posts.length === 1. Stamped on the idea for the board label + re-gen provenance.
export const GENERATION_MODES = ["thread", "single"] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export function isGenerationMode(v: unknown): v is GenerationMode {
  return v === "thread" || v === "single";
}

// 소재란에 들어온 값이 "x.com 글 링크 하나"인지 — 컴포저(버튼·안내 문구)와 POST
// 라우트(link-thread 잡 분기)가 같은 판정을 쓴다. 링크 + 다른 텍스트가 섞이면
// 일반 소재로 취급한다 (붙여넣은 본문 안의 링크까지 잡으면 안 되므로).
export function isXUrl(text: string): boolean {
  return /^https?:\/\/(x|twitter)\.com\/[^/\s]+\/status\/\d+\S*$/.test(text.trim());
}

// 소재란 값이 링크 잡으로 보낼 URL인지, 어떤 수집 경로인지.
//   "x"   → 로그인 브라우저 수집 (scripts/ingest-x.mjs)
//   "web" → 서버 fetch 본문 추출 (scripts/ingest-web.mjs) — 일반 블로그·뉴스
//   null  → 링크 잡 아님 (텍스트 소재, 또는 아직 미지원인 유튜브: 대본 추출 확정 전)
export type LinkKind = "x" | "web";
export function detectLinkTopic(text: string): LinkKind | null {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/.test(t)) return null;
  if (isXUrl(t)) return "x";
  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(t)) return null;
  if (/^https?:\/\/(x|twitter)\.com\//i.test(t)) return null; // 프로필 등 글이 아닌 X 링크
  return "web";
}

// 붙여넣기가 꼬여 URL 두 개가 겹쳐 붙은 소재를 복구한다 (실측 2026-08-10: 커서가
// URL 중간에 있는 채로 재붙여넣기 → "https://x.com/thedankhttps://x.com/…oe/status/…"
// 가 링크 판정을 통과 못 해 깨진 문자열이 그대로 모델에 감). 공백 없는 한 덩어리인데
// 링크 판정에 실패했고 안에 온전한 X 글 URL이 박혀 있으면 그 URL만 꺼낸다.
// 공백이 있으면 본문 소재(글 속 링크)로 존중해 손대지 않는다.
export function repairLinkTopic(text: string): string {
  const t = text.trim();
  if (!t || /\s/.test(t)) return text;
  // 온전한 X 글 URL 하나를 추출 (쿼리는 보존). isXUrl 의 관대한 꼬리(\S*) 탓에
  // "…/status/123https://…" 같은 이어붙임도 유효 판정을 통과하므로, 판정 결과와
  // 무관하게 추출로 정규화한다. 추출 결과가 입력과 같으면 그대로 둔다.
  const m = t.match(/https?:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+(?:\?[^\s]*)?/);
  if (!m || m[0] === t) return text;
  return m[0];
}

// One accent per type, used only on the small type label (UI rule: neutral
// base, accent only when it carries meaning, one at a time per element).
export const IDEA_TYPE_COLOR: Record<IdeaType, string> = {
  reaction: "text-rose-700",
  recommend: "text-amber-700",
  essay: "text-teal-700",
  info: "text-blue-700",
  curation: "text-orange-700",
  case: "text-neutral-500", // 은퇴한 결이라 강조색을 뺀다
  storytelling: "text-neutral-500", // 은퇴한 결이라 강조색을 뺀다
};

// A Threads section (one post in the thread) caps at 500 characters. The model
// is asked to split for readability before hitting this; the UI also shows the
// count so you can see the budget.
export const MAX_POST_CHARS = 500;

// ── Character counting + the ≤500 guarantee ──────────────────────────────────
// "500자" is counted in GRAPHEME CLUSTERS — what a person sees as one character:
// a Hangul syllable is 1, an emoji or combined mark is 1, not its UTF-16
// code-unit count. This single counter backs the editor counter, the overflow
// warning, the editor clamp, AND the server-side split, so every place agrees on
// the number. Falls back to code points where Intl.Segmenter is unavailable
// (for emoji-free Korean text the two are identical anyway).

let _graphemeSeg: Intl.Segmenter | null = null;
function graphemes(s: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    if (!_graphemeSeg) {
      _graphemeSeg = new Intl.Segmenter("ko", { granularity: "grapheme" });
    }
    const out: string[] = [];
    for (const seg of _graphemeSeg.segment(s)) out.push(seg.segment);
    return out;
  }
  return Array.from(s); // code points: exact for emoji-free text
}

// The canonical 글자 수. Use this everywhere instead of String.length.
export function countChars(s: string): number {
  return graphemes(s).length;
}

// Truncate to at most `limit` characters (grapheme-aware), so a paste in the
// editor can't push a post over the cap.
export function clampChars(s: string, limit: number = MAX_POST_CHARS): string {
  const g = graphemes(s);
  return g.length <= limit ? s : g.slice(0, limit).join("");
}

// Last resort: a single token with no usable boundary (e.g. a giant URL) gets
// hard-cut into grapheme chunks of at most `limit`.
function hardChunks(s: string, limit: number): string[] {
  const g = graphemes(s);
  const out: string[] = [];
  for (let i = 0; i < g.length; i += limit) out.push(g.slice(i, i + limit).join(""));
  return out;
}

// Greedily pack atoms into pieces of at most `limit`, joined by `joiner`. An
// atom longer than the limit is first broken down by `breakup` (whose pieces are
// each guaranteed ≤ limit).
function packAtoms(
  atoms: string[],
  joiner: string,
  limit: number,
  breakup: (a: string) => string[]
): string[] {
  const out: string[] = [];
  let cur = "";
  const add = (piece: string) => {
    if (!cur) {
      cur = piece;
      return;
    }
    const cand = cur + joiner + piece;
    if (countChars(cand) <= limit) cur = cand;
    else {
      out.push(cur);
      cur = piece;
    }
  };
  for (const atom of atoms) {
    if (!atom) continue;
    if (countChars(atom) <= limit) add(atom);
    else for (const sub of breakup(atom)) add(sub);
  }
  if (cur) out.push(cur);
  return out;
}

// Split one post into complete pieces, each ≤ `limit` characters. Prefers
// paragraph (blank-line) boundaries, then sentence ends, then spaces, and only
// hard-cuts a single oversized token as a last resort — so no piece ends
// mid-thought and no content is lost. Returns [text] unchanged when it already
// fits. This is what makes the ≤500 rule a structural guarantee, not a hope.
export function splitToLimit(text: string, limit: number = MAX_POST_CHARS): string[] {
  const t = text.trim();
  if (!t) return [];
  if (countChars(t) <= limit) return [t];

  const splitBySpace = (s: string) =>
    packAtoms(s.split(/\s+/), " ", limit, (w) => hardChunks(w, limit));
  const splitBySentence = (s: string) =>
    packAtoms(s.split(/(?<=[.!?。！？…])\s+/), " ", limit, splitBySpace);

  // Pack paragraphs; a paragraph that alone exceeds the limit becomes its own
  // sentence-split pieces.
  const paras = t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const para of paras) {
    if (countChars(para) <= limit) {
      if (!cur) cur = para;
      else if (countChars(cur + "\n\n" + para) <= limit) cur += "\n\n" + para;
      else {
        out.push(cur);
        cur = para;
      }
    } else {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      out.push(...splitBySentence(para));
    }
  }
  if (cur) out.push(cur);
  // 고아 꼬리 방지 (08-11 실측: 514자 게시물이 480자+34자로 쪼개져 34자짜리 칸이
  // 생김): 마지막 조각이 너무 짧으면 앞 조각과 합쳐 중간 문장 경계에서 균형 분할.
  if (out.length >= 2 && countChars(out[out.length - 1]) < MIN_SPLIT_TAIL) {
    const balanced = splitBalanced(
      out[out.length - 2] + "\n\n" + out[out.length - 1],
      limit
    );
    if (balanced) out.splice(out.length - 2, 2, ...balanced);
  }
  return out;
}

// 균형 분할이 개입하는 꼬리 길이 문턱. 이보다 짧은 마지막 조각은 독립 칸으로서
// 어색하다 (한 문장짜리 고아 칸).
const MIN_SPLIT_TAIL = 100;

/** 문단·문장 경계 중 양쪽이 limit 이내이면서 가장 반반에 가까운 지점에서 2분할. */
function splitBalanced(merged: string, limit: number): [string, string] | null {
  const re = /\n{2,}|(?<=[.!?。！？…])\s+/g;
  let best: [string, string] | null = null;
  let bestGap = Infinity;
  let m: RegExpExecArray | null;
  while ((m = re.exec(merged))) {
    const at = m.index + m[0].length;
    const a = merged.slice(0, at).trim();
    const b = merged.slice(at).trim();
    if (!a || !b) continue;
    const ca = countChars(a);
    const cb = countChars(b);
    if (ca > limit || cb > limit) continue;
    const gap = Math.abs(ca - cb);
    if (gap < bestGap) {
      bestGap = gap;
      best = [a, b];
    }
  }
  return best;
}

// A saved snapshot in an idea's edit history. Each entry holds the version that
// was REPLACED (so revisions[] reads as "here's a past version") plus, when the
// change came from an AI revision (DAS-38), the feedback that drove it.
export interface IdeaRevision {
  at: string; // ISO timestamp of the save
  posts: string[]; // the posts as they were saved at that point (the replaced version)
  // AI-revision signal — absent for plain manual edits. This is the missing
  // "왜 고쳤나" the learning loop needs. The classifier (DAS-40) later fills
  // `dimensions` from `feedback`.
  feedback?: string; // henry's free-text feedback that drove the change
  scope?: "post" | "thread"; // what the feedback was anchored to
  postIndex?: number; // for scope==="post": which 칸 the feedback targeted
  dimensions?: string[]; // rubric dimension keys (filled by DAS-40)
}

// ── Fact-check / 근거 검토 (오른쪽 패널) ─────────────────────────────────────
// 생성된 스레드의 주장·관점마다 "무슨 근거로, 어디서 나온 말이고, 검증됐는지"를
// 한 항목으로 묶는다. 교육자 스탠스로 해석·관점을 얹는 순간 사실이 아닌 게 섞일 위험이
// 생기는데(브랜드 신뢰 직결), 이 배열이 henry가 게시 전에 칸별로 검토할 수 있는 면이 된다.
export const FACT_CHECK_STATUSES = ["verified", "inferred", "opinion", "unverified"] as const;
export type FactCheckStatus = (typeof FACT_CHECK_STATUSES)[number];

export const FACT_CHECK_STATUS_LABEL: Record<FactCheckStatus, string> = {
  verified: "확인됨", // 웹 검색·출처로 교차확인된 사실
  inferred: "추정", // 일반적으로 참인 추론·맥락 (단정 아님)
  opinion: "henry 관점", // 사실이 아니라 henry의 해석·의견
  unverified: "미확인", // 소재에만 있고 교차확인 못 한 주장 → henry 검토 요망
};

export interface FactCheck {
  claim: string; // 글에 등장한 사실/주장/관점 한 줄
  basis: string; // 그렇게 볼 수 있는 근거 한 줄 (무슨 사실에 기반하는지)
  source: string; // 출처(매체·URL) 또는 "henry 관점"·"일반 상식"
  status: FactCheckStatus;
  postIndex?: number; // 연결되는 칸 (0-based). 모르면 생략.
}

// ── Humanize / AI 티 진단 (오른쪽 패널 2번째 섹션) ──────────────────────────
// 생성된 초안에서 "AI가 쓴 티"를 진단한 한 항목. 2개 층으로 나온다:
//   R = 결정론 정규식 신호 (src/lib/humanize/rules.ts, 비용 0, 클라이언트에서 즉시 재계산)
//   J = LLM 판정 신호 (Phase 4, 골드 대조·제안만) — Phase 1은 R만 채운다.
// 판정 기준 SSOT는 docs/humanize-criteria-v1.md (v1.1). severity는 그 문서의
// S1(단독 지적) / S2(2개 이상 겹칠 때) / S3(참고, 직접 지적 안 함)를 그대로 쓴다.
export type HumanizeLayer = "R" | "J";
export type HumanizeSeverity = "S1" | "S2" | "S3";

export interface HumanizeFinding {
  postIndex: number; // 연결되는 칸 (0-based). 훅(0)이 UI 최상단.
  layer: HumanizeLayer; // R=정규식 / J=LLM
  code: string; // 기준 문서의 규칙 id (예: "R1-1", "R2-5")
  label: string; // 짧은 규칙 이름 (UI 헤더용)
  quote: string; // 지적된 문장/표현 한 줄
  why: string; // 왜 AI 티인지 한 줄
  suggestion?: string; // 수정 제안 한 줄 (있을 때)
  severity: HumanizeSeverity;
}

export interface ContentIdea {
  id: string;
  platform: Platform;
  type: IdeaType;
  posts: string[]; // current version (what you edit + post); each ≤ 500 chars
  original: string[]; // the AI's first draft — immutable baseline for the diff
  // Per-post image directives, index-aligned to `posts`. images[i] is the
  // production note for post i ("유형 | 소스 | 핵심 요소"), or "" when that post
  // carries no image. A separate field (not inline in the body) so the post text
  // stays clean to copy-paste, while the directive shows as a note in the UI.
  images?: string[];
  // Actually-attached images per post, index-aligned to `posts`. media[i] is the
  // list of image URLs attached to post i (Threads allows several per post),
  // each served from /content-media/**. This is the REAL pasted image, distinct
  // from `images` (the AI's text directive of *what* to attach). Bytes live on
  // disk under public/content-media/<id>/, so only URLs sit in the JSON.
  media?: string[][];
  // Collected-but-unassigned images (link-thread 잡의 예비 풀): the ingest grabbed
  // them but the draft didn't place them in any 칸. Kept on the card so henry can
  // attach one to a 칸 while editing instead of digging through the run folder.
  // Same /content-media/** URLs as `media`.
  spareMedia?: string[];
  // Rebuttal markers from the link-thread 여론 게이트: which 칸 a rebutting reply
  // targets (post is 1-based; 0 = couldn't pin down) plus the reply verbatim.
  // The preview badges those 칸 so henry sees WHERE to double-check, not just
  // that a rebuttal exists. Approximate — later splits/edits can shift by a 칸.
  rebutted?: { post: number; quote: string; quoteKo?: string }[];
  // Per-칸 representative source URL, index-aligned to `posts` ("" = unknown).
  // Renders as a per-칸 '출처' button so henry can jump to what the 칸 was
  // written from without the URL living in the post text (henry 07-10).
  postSources?: string[];
  // How this draft was generated: "thread" (multi-칸 run, the default) or
  // "single" (one key-points 칸). Absent on legacy rows + manual threads — read
  // those by posts.length (1 → single). Drives the board's 단일/스레드 hint.
  mode?: GenerationMode;
  // 시안 3벌 묶음 (henry 07-12): link-thread 잡이 후킹이 다른 초안 3벌을 카드
  // 3장으로 적재할 때, 같은 베이스 runId 를 공유한다. 보드에서 하나를 열면
  // 그룹 전체가 3패널 비교 팝업으로 함께 열린다. 단일 생성 카드에는 없다.
  variantGroup?: string;
  variantIndex?: number; // 그룹 내 시안 번호 (1-based)
  // 이 그룹이 원래 만들려던 시안 수 (생성 시점 도장). 보드의 형제 카드 수가
  // 이보다 적으면 일부 벌 생성이 실패한 것 — 대표 카드·비교 팝업이 "못 만든
  // 벌"을 아이콘으로 표시하는 근거다 (2026-08-11: "3벌인데 2개만" 조용한 실패 방지).
  variantTotal?: number;
  // "+다른 후킹" 확장안으로 생성된 카드에만: 강제한 후킹 계열(HOOK_FAMILIES id).
  // 어떤 계열이 실제로 올라가고 성과를 내는지가 선호 학습의 원자료가 된다.
  hookFamily?: string;
  // 관점 확장안으로 생성된 카드에만: 이 시안이 잡은 해석 각도(PERSPECTIVES id).
  // 같은 소재를 다른 각도로 본 시안임을 팝업 칩·중복 방지에 쓴다 (henry 07-16).
  perspective?: string;
  // 사례 모음 카드에만: 사례 목록 (순서 = 칸 2..N+1). 시안 3벌이 같은 사례 집합을
  // 싣는다. 카드 모달의 목차 레일이 순서 바꾸기·빼기에 쓴다 (henry 픽 swap/5).
  roundup?: RoundupIdeaMeta;
  intent: string; // who it's for + the before→after shift the thread leads
  sourceQuote: string; // a verbatim sentence(s) from the source it's rooted in
  sourceNote: string; // where the source is from + how it's used / verified
  // Per-claim 근거 검토 (오른쪽 패널). Each entry pins a claim/opinion in the
  // thread to its basis, source, and verification status so henry can audit
  // facts before posting. Optional: legacy rows + manual threads have none.
  factChecks?: FactCheck[];
  // AI 티 진단. R층(정규식)은 posts에서 클라이언트가 즉시 재계산하므로 저장하지
  // 않는다. 여기 저장되는 건 J층(LLM, Phase 4) findings뿐 — 생성 잡 꼬리에서
  // 채워지고 카드 오픈 시 대기 0. 없으면 미생성(legacy·수동 스레드).
  humanize?: { findings: HumanizeFinding[] };
  date: string; // YYYY-MM-DD it was generated for
  createdAt: string; // ISO timestamp

  // Provenance: which writing guidance produced this draft. Without this, a diff
  // from two weeks ago is an anecdote — you can't tell whether the AI "kept
  // doing X" under the current prompt or an old one. Stamped at generation time;
  // absent on legacy rows + manual threads.
  promptVersion?: string; // short hash of data/threads-prompt.md content
  rubricVersion?: number; // ThreadsRubric.version at generation time
  lessonsVersion?: number; // LessonsStore.version (approved learned rules) at gen time

  // Editing + posting workflow
  edited?: boolean; // posts differ from original
  editedAt?: string; // last edit save
  revisions?: IdeaRevision[]; // edit history (each save appends the new posts)
  posted?: boolean; // marked as published
  postedAt?: string; // when it was marked posted
  // 예약 리마인더 (기록 전용): henry가 "이 시각에 올리겠다"고 적어둔 ISO 시각.
  // 크론도 자동 게시도 없다 — 보드 배지로만 보이고, 게시는 항상 직접 한다.
  scheduledAt?: string;

  // "안 올림" signal (능동 캡처): henry reviewed this thread and decided NOT to
  // post it. An unposted thread left to sit means "별로였다" — but we only treat
  // it as a negative signal when henry actively marks it (no auto-inference from
  // age), so the learning loop never mislabels a thread he simply hasn't gotten
  // to yet. `passReason` is his one-line why ("톤이 안 맞아", "사실이 의심돼"…),
  // the strong targeted signal the next generation must avoid. Mutually exclusive
  // with `posted` (marking one clears the other).
  passed?: boolean;
  passReason?: string;
  passedAt?: string;

  // Promotion (DAS-38/41): henry marked this thread as a good example, appending
  // it to the few-shot (gold) corpus so future drafts learn its voice. The
  // button IS the approval — gold is defined by henry's judgment, never auto.
  promoted?: boolean;
  promotedAt?: string;

  // Freshness: a just-generated thread is `viewed: false` so the board can mark
  // it NEW; opening it (reading it) flips it to true and the badge clears.
  // Legacy rows predate this field → `viewed` is undefined → not treated as new
  // (so existing threads don't all light up). "is new" === `viewed === false`.
  viewed?: boolean;
}

// ── Voice rubric (DAS-39) ────────────────────────────────────────────────────
// The explicit standard for "a good post", reverse-extracted from henry's own
// high-engagement posts (the few-shot corpus) + 작성 지침 + Voice DNA. Two
// layers: per-칸 (post) and whole-thread. Each dimension is scored 1-5 in spirit,
// but the live signal is `feedbackCount` — how often henry's revision feedback
// touched it (DAS-40 fills this). `weight` is derived from that frequency, so
// the dimensions henry keeps fixing get pushed harder in the next generation.
// Definitions are henry-approved (SSOT); only weight/feedbackCount move on their
// own.
export interface RubricDimension {
  key: string; // stable id (e.g. "hook")
  label: string; // Korean display name
  definition: string; // what "good" means for this dimension
  weight: number; // generation emphasis; starts equal, rises with feedbackCount
  feedbackCount: number; // how many applied feedbacks classified into this dim
  // v2 (2026-08-29, Shreya/Hamel eval 인터뷰 반영): 기준 1개 = 실패 모드 1개.
  // kind — topdown: 과제 성격에서 도출(AI가 잘 세움) / bottomup: henry의 실제
  //        교정·반려 데이터에서 나온 취향(사람만 세울 수 있음, 자동 승격 금지).
  // check — mechanical: 정규식·코드로 판별 가능(content-ideas-style-eval 계열) /
  //         judge: LLM 판정 필요(기준당 호출 1개, 합격/불합격, 점수 금지).
  kind?: "topdown" | "bottomup";
  check?: "mechanical" | "judge";
}

export interface ThreadsRubric {
  version: number;
  updatedAt: string; // YYYY-MM-DD (local)
  post: RubricDimension[]; // per-칸 dimensions
  thread: RubricDimension[]; // whole-thread dimensions
}

// ── Learning loop, outer clock (weekly distillation) ─────────────────────────
// A diff between an AI draft and what henry posted is EVIDENCE, not automatically
// a lesson. The weekly distiller reads accumulated corrections and proposes a few
// durable rules — but only after deciding WHAT each correction means. The four
// types route a correction to the right place instead of bumping a voice weight
// for everything:
//   preference — a writing/voice taste → goes into the writing guidance.
//   retrieval  — henry added a missing fact → the research step searched the
//                wrong place, not a voice problem. Tell generation to pull it.
//   check      — henry removed a risky claim/commitment → a verification gate.
//   oneoff     — situational judgment that shouldn't generalize → dropped.
export const LESSON_TYPES = ["preference", "retrieval", "check", "oneoff"] as const;
export type LessonType = (typeof LESSON_TYPES)[number];

export const LESSON_TYPE_LABEL: Record<LessonType, string> = {
  preference: "글쓰기 취향",
  retrieval: "소재·리서치 보강",
  check: "게시 전 검증",
  oneoff: "일회성 (규칙화 안 함)",
};

export const LESSON_TYPE_HINT: Record<LessonType, string> = {
  preference: "말투·구성·표현 취향 → 작성 지침에 반영",
  retrieval: "빠진 사실을 채운 패턴 → 다음 글은 미리 리서치로 확인",
  check: "위험한 약속·표현을 뺀 패턴 → 게시 전 한 번 더 점검",
  oneoff: "그때 한정 판단 → 규칙으로 만들지 않음",
};

// A durable, henry-approved learned rule. Lives in threads-lessons.json and gets
// injected into the generation prompt grouped by type. Never "oneoff" (those are
// dropped at the proposal stage, never stored).
export interface LearnedRule {
  id: string;
  type: Exclude<LessonType, "oneoff">;
  text: string; // the one-line durable rule, as henry approved/edited it
  evidenceCount: number; // how many corrections it was distilled from (so far)
  createdAt: string; // ISO
  updatedAt: string; // ISO (bumped when a later batch refines it)
}

// One candidate the weekly distiller proposes. henry keeps / drops / edits each
// in the review popup. `decision` is unset until he reviews it.
export interface LessonCandidate {
  id: string;
  type: LessonType;
  text: string; // proposed durable rule (henry can edit before applying)
  rationale: string; // one line: the pattern this was distilled from
  evidence: string[]; // the raw corrections it came from (shown on expand)
  decision?: "keep" | "drop";
  mergeInto?: string; // id of an existing LearnedRule this refines, if any
}

export type ProposalStatus = "pending" | "applied" | "dismissed";

// A weekly batch of candidates awaiting henry's review (drives the popup).
export interface LessonProposal {
  id: string;
  createdAt: string; // ISO
  status: ProposalStatus;
  fromAt: string; // evidence window start (ISO) — usually last distillation
  toAt: string; // evidence window end (ISO) — now
  reviewedCount: number; // # of reviewed corrections that fed this batch
  candidates: LessonCandidate[];
  appliedAt?: string;
}

export interface LessonsStore {
  version: number; // bumps each time approved rules change
  updatedAt: string; // ISO
  lastDistilledAt?: string; // ISO of the last completed distillation
  rules: LearnedRule[]; // henry-approved durable rules
  proposals: LessonProposal[]; // history; at most one is "pending" at a time
}

// Build a revision-history snapshot of the version being replaced. When the
// change came from an AI revision (DAS-38), the owner's feedback is attached so
// the learning loop later has the "왜 고쳤나". A plain manual edit (no feedback)
// gets a bare {at, posts} entry. `postIndex` is only kept for post-scoped
// feedback that actually named a 칸.
export function buildRevisionSnapshot(
  prevPosts: string[],
  at: string,
  meta?: { feedback?: string; scope?: "post" | "thread"; postIndex?: number }
): IdeaRevision {
  const feedback = (meta?.feedback ?? "").trim();
  if (!feedback) return { at, posts: prevPosts };
  const scope: "post" | "thread" = meta?.scope === "post" ? "post" : "thread";
  return {
    at,
    posts: prevPosts,
    feedback,
    scope,
    ...(scope === "post" && typeof meta?.postIndex === "number"
      ? { postIndex: meta.postIndex }
      : {}),
  };
}

// Treat a stored idea defensively: legacy rows may predate `original`/revisions.
export function normalizeIdea(idea: ContentIdea): ContentIdea {
  const posts = Array.isArray(idea.posts) ? idea.posts : [];
  // Keep images index-aligned to posts: pad/truncate so the UI can pair them up
  // even on legacy rows (predating images) or after edits changed the post count.
  const rawImages = Array.isArray(idea.images) ? idea.images : [];
  const images = posts.map((_, i) => String(rawImages[i] ?? ""));
  // Keep media index-aligned to posts too: each entry is an array of URL
  // strings (drop anything non-string), padded to one slot per post.
  const rawMedia = Array.isArray(idea.media) ? idea.media : [];
  const media = posts.map((_, i) => {
    const slot = rawMedia[i];
    return Array.isArray(slot)
      ? slot.map((u) => String(u ?? "")).filter((u) => u.length > 0)
      : [];
  });
  // Rebuttal markers: drop empty quotes, clamp post into current range (edits
  // can shrink posts — out-of-range degrades to 0 = "칸 미상", still listed in
  // the sourceNote warning).
  const rebutted = (Array.isArray(idea.rebutted) ? idea.rebutted : [])
    .map((r) => ({
      post:
        typeof r?.post === "number" && r.post >= 1 && r.post <= posts.length
          ? Math.floor(r.post)
          : 0,
      quote: String(r?.quote ?? "").trim(),
      quoteKo: String(r?.quoteKo ?? "").trim(),
    }))
    .filter((r) => r.quote.length > 0);
  // Per-칸 source URLs: align to posts, keep http(s) only.
  const rawSources = Array.isArray(idea.postSources) ? idea.postSources : [];
  const postSources = posts.map((_, i) => {
    const u = String(rawSources[i] ?? "").trim();
    return /^https?:\/\//.test(u) ? u : "";
  });
  // Spare pool: plain string list, dedup against per-post media so attaching an
  // image in an edit doesn't leave a stale copy in the pool.
  const attached = new Set(media.flat());
  const spareMedia = (Array.isArray(idea.spareMedia) ? idea.spareMedia : [])
    .map((u) => String(u ?? ""))
    .filter((u) => u.length > 0 && !attached.has(u));
  // Keep fact-checks defensive: drop malformed entries, coerce status to a known
  // value, clamp postIndex into the current posts range (edits can shrink posts).
  const factChecks = Array.isArray(idea.factChecks)
    ? idea.factChecks
        .map((f): FactCheck | null => {
          const claim = String(f?.claim ?? "").trim();
          if (!claim) return null;
          const status = (FACT_CHECK_STATUSES as readonly string[]).includes(
            f?.status as string
          )
            ? (f.status as FactCheckStatus)
            : "unverified";
          const pi = f?.postIndex;
          const postIndex =
            typeof pi === "number" && pi >= 0 && pi < posts.length
              ? pi
              : undefined;
          return {
            claim,
            basis: String(f?.basis ?? "").trim(),
            source: String(f?.source ?? "").trim(),
            status,
            ...(postIndex !== undefined ? { postIndex } : {}),
          };
        })
        .filter((f): f is FactCheck => f !== null)
    : [];
  return {
    ...idea,
    original:
      Array.isArray(idea.original) && idea.original.length
        ? idea.original
        : posts,
    images,
    media,
    ...(spareMedia.length > 0 ? { spareMedia } : { spareMedia: undefined }),
    ...(rebutted.length > 0 ? { rebutted } : { rebutted: undefined }),
    ...(postSources.some((u) => u) ? { postSources } : { postSources: undefined }),
    factChecks,
    revisions: Array.isArray(idea.revisions) ? idea.revisions : [],
  };
}
