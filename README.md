# 스레드 답글

내 스레드 글에 달린 댓글을 모아, **내 말투로 답글 초안**을 써 주는 맥 앱입니다. 질문 댓글에는 근거를 찾아 붙이고, 보내기는 내가 누른 것만 나갑니다.

내 컴퓨터에서만 돌고, 내 계정 토큰은 내 컴퓨터 밖으로 나가지 않아요.

## 할 수 있는 일

- **내 말투로 초안**: 연결하면 내가 예전에 단 답글을 모아 "말투 규칙책"을 만들어요. 초안은 그 규칙책과 비슷한 상황의 내 실제 답글을 보고 써요.
- **질문엔 근거**: `내 자료` 폴더의 문서, 내 지난 글, 웹 검색에서 답을 찾아 문장마다 어디서 왔는지 보여 줘요. 원문 화면에 형광펜을 칠한 캡처도 찍어요.
- **같이 만드는 자료**: 근거가 없는 질문이면 초안 아래에 "이거 알려주세요"가 떠요. 한 줄로 답하면 초안을 다시 쓰고, 그 답은 `내 자료/같이 만든 답`에 쌓여 다음 질문부터 근거가 돼요.
- **정리**: 10분마다 새 댓글을 가져오고 초안을 미리 써 둬요. 필요 없는 댓글은 하나씩, 또는 한 번에 건너뛸 수 있어요(되돌리기 있음).
- **캡처 첨부** (선택): 근거 캡처를 답글에 이미지로 붙여 보내요. 올린 이미지는 보낸 뒤 바로 지워요.

## 설치 (5분)

비공개 저장소라서 먼저 **GitHub 초대를 수락**해야 해요. 초대 메일의 [View invitation] > [Accept invitation]을 누르고, 브라우저가 그 GitHub 계정으로 로그인된 상태여야 저장소 페이지가 보여요(로그인 안 돼 있으면 "페이지를 찾을 수 없음"이 떠요). 그다음 방법은 둘 중 하나입니다.

**방법 1. AI에게 맡기기 (Claude Code·Codex 등).** 이 저장소 링크를 주고 "설치해줘"라고 하면 됩니다. 아래 [AI 에이전트용](#ai-에이전트에게-설치를-맡길-때) 절차를 따라요.

**방법 2. 직접.**

1. 이 저장소 페이지에서 초록색 **Code** 버튼 > **Download ZIP**을 누릅니다. **다운로드** 폴더에 생긴 `threads-replies-main.zip`을 더블클릭하면 같은 곳에 `threads-replies-main` 폴더가 생겨요.
2. **터미널**을 엽니다. `⌘ + 스페이스` > "터미널"(Terminal) > Enter.
3. `cd `(뒤에 한 칸 띄우기)를 입력하고, 압축을 푼 폴더를 터미널 창으로 끌어다 놓은 뒤 Enter.
4. `bash install.sh`를 입력하고 Enter.

Homebrew, 관리자 비밀번호, 개발 도구는 필요 없어요. 앱을 돌리는 엔진(Node.js)도 공식 사이트에서 알아서 받습니다. `설치 완료`가 나오면 끝이고, 인터넷 속도에 따라 2~6분 걸려요. 맥 오른쪽 위에 "백그라운드 항목이 추가됨" 알림이 뜨면, 앱이 로그인 때 자동으로 켜지게 등록한 것이니 그대로 두세요.

개발자라서 `gh`(GitHub 명령줄 도구)에 이미 로그인돼 있다면 위 1~4 대신 한 줄로도 됩니다. `gh`가 뭔지 모르면 건너뛰세요.

```bash
gh api repos/henryoon0/threads-replies/contents/install.sh -H "Accept: application/vnd.github.raw" | bash
```

## 스레드 연결 (처음 한 번, 15분)

설치가 끝나면 브라우저에 연결 화면이 열려요. 메타가 본인만 할 수 있게 막아 둔 일이라 두 가지 방법이 있어요.

**AI에게 맡기기 (Aside 브라우저가 있을 때).** Aside 브라우저 앱이 설치돼 있어야 해요. 터미널에 `aside --version`을 쳐서 숫자가 나오면 있는 거예요. 있으면 아래 한 줄을 **직접 터미널에 붙여넣으세요.** 그러면 AI가 떠서 나머지를 진행해요.

```bash
bash ~/.threads-replies/app/scripts/connect-with-aside.sh
```

AI가 Aside 브라우저 창에서 메타 앱을 만들고, 토큰을 받아 연결 화면에 바로 붙여넣어요. 로그인이 필요할 때만 멈추고 알려 줍니다. 비밀번호는 AI가 치지 않고, 토큰은 채팅에 나오지 않아요. AI가 따라 하는 순서는 [docs/connect-playbook.md](docs/connect-playbook.md)에 있어요.

**직접 하기.** 연결 화면(`http://localhost:3457`)에 단계마다 정확한 메뉴 경로와 바로가기 링크가 있어요. 그 화면을 보며 따라 하세요. 요약하면 이렇습니다.

1. 스레드 계정을 **공개**로 둡니다. 비공개 계정은 토큰을 만들 수 없고, 쓰는 동안에도 공개여야 토큰이 연장돼요(메타 규칙: 비공개로 바꾸면 90일 뒤 다시 연결해야 해요).
2. [메타 개발자 사이트](https://developers.facebook.com/apps/creation/)에서 앱을 만들고, 사용 사례로 **Threads API 액세스**를 고릅니다. 내 계정만 쓰는 앱이라 앱 심사는 필요 없어요.
3. 사용 사례 > Threads API 액세스 > 맞춤 설정 > 권한에서 권한 5개(`threads_basic`, `threads_read_replies`, `threads_manage_replies`, `threads_content_publish`, `threads_manage_insights`)를 **토큰을 만들기 전에** 추가합니다.
4. 앱 역할 > 역할 > 사람 추가 > **Threads 테스터**에 내 아이디를 넣고, 스레드 설정 > 계정 > 웹사이트 권한 > 초대에서 수락합니다. 휴대폰 스레드 앱이나 웹([threads.com/settings/account](https://www.threads.com/settings/account)) 어느 쪽이든 돼요.
5. 사용 사례 설정 맨 아래 **User Token Generator**에서 토큰을 만들어 복사한 뒤, 연결 화면에 붙여넣고 [연결하기]를 누릅니다.

초록색 **"@내아이디 연결됐어요"**가 뜨면 성공이에요. 바로 뒤에서 말투 익히기가 시작돼요(몇 분). 토큰은 60일짜리인데, 앱이 켜져 있으면 알아서 연장합니다.

## 선택 기능

| 기능 | 켜는 법 | 없으면 |
| --- | --- | --- |
| AI 초안 | 이 맥에 [Claude Code](https://claude.com/claude-code)나 Codex가 로그인돼 있으면 자동으로 켜져요 | 초안 없이 직접 써서 보낼 수 있어요 |
| 원문 캡처 | 설치할 때 자동으로 받아요 (약 150MB) | 근거 문장만 보여요 |
| X(트위터) 글 캡처 | 처음 X 글을 찍을 때 뜨는 창에서 X에 한 번 로그인 | 웹 글만 찍혀요 |
| 캡처를 답글에 붙이기 | `bash ~/.threads-replies/app/scripts/login-cloudflare.sh` 실행 → 브라우저에서 Cloudflare 무료 계정으로 로그인 → Allow | 답글이 글자로만 나가요 |

캡처 첨부는 이미지를 잠깐 공개해야 스레드가 가져갈 수 있어서, 내 Cloudflare 계정에 `threads-img-…` 프로젝트를 하나 만들어 씁니다. 올린 이미지는 답글이 발행되면 파일과 배포 기록까지 지워서 쌓이지 않아요.

## 사용법

1. 응용 프로그램(Applications) 폴더의 **스레드 답글**을 누르거나, 브라우저에서 `http://localhost:3457`을 엽니다.
2. 왼쪽 목록에서 댓글을 고르면 오른쪽에 초안이 있어요. 고칠 게 있으면 고치고 **보내기**. 5초 안에 되돌릴 수 있어요.
3. 질문 댓글엔 근거 칩과 원문 캡처가 붙어요. 근거가 없으면 초안 아래 질문에 한 줄로 답해 주세요.
4. **내 자료 폴더** 버튼을 누르면 자료 폴더가 열려요. 강의 자료, FAQ, 제품 설명처럼 자주 묻는 내용을 `.md`나 `.txt`로 넣어 두면 근거로 써요.
5. 말투가 어색하면 위쪽의 **다시 만들기**를 누르세요. 답글이 쌓일수록 더 비슷해져요.

## AI 에이전트에게 설치를 맡길 때

> **For AI agents:**
> 1. This is a private repository. Install with `gh api repos/henryoon0/threads-replies/contents/install.sh -H "Accept: application/vnd.github.raw" | bash` (needs `gh auth login` with an account invited to the repo), or clone the repo and run `bash install.sh` inside it.
> 2. It needs no sudo and no Homebrew. It downloads Node.js from nodejs.org and writes only to `~/.threads-replies`, `~/Library/LaunchAgents/com.threads-replies.plist`, `~/Applications/스레드 답글.app`, and the Playwright browser cache `~/Library/Caches/ms-playwright`. If your sandbox blocks network or writes outside the working folder, ask the user to allow exactly these.
> 3. The app runs at `http://localhost:3457`. Check it with `curl -s http://localhost:3457/api/account`, which returns `{"connected":false,...}` before connecting.
> 4. Connecting Threads needs the user's own Meta and Threads login. If the user has Aside browser, run `bash ~/.threads-replies/app/scripts/connect-with-aside.sh` and let the user handle logins. Otherwise tell the user to follow the on-screen guide. Never ask the user to paste the token into the chat. The token goes into the app page only.
> 5. Success signal: the page shows "@username 연결됐어요", and `/api/voice` goes to `"state":"done"` within a few minutes.

## 안 될 때

아래 명령어 결과를 붙여서 알려주세요. 토큰 값은 출력하지 않아요.

```bash
bash ~/.threads-replies/bin/doctor.sh
```

- **화면이 안 열려요**: 설치 직후엔 30초쯤 걸려요. 진단 결과의 `화면 응답(포트 3457)`이 `200`인지 보세요. `응답 없음`이면 설치 명령을 한 번 더 실행하세요.
- **"토큰이 맞지 않거나 만료됐어요"**: 토큰을 새로 만들어 붙여넣으세요. 복사할 때 앞뒤가 잘리지 않았는지도 확인하세요.
- **"댓글을 읽는 권한이 없어요"**: 3단계 권한을 빠뜨린 거예요. 권한을 추가한 뒤 토큰을 **새로** 만들어야 해요.
- **테스터 초대에 수락 버튼이 없고 "삭제"만 보여요**: 메타 쪽에 알려진 오류예요. 앱을 새로 만들어 다시 초대하면 풀린 사례가 있어요.
- **초안이 안 써져요**: 진단 결과의 `AI 도구`가 둘 다 `없음`이면 Claude Code나 Codex에 로그인해 주세요.

## 알아두면 좋은 점

- **보내기는 내가 누른 것만** 나가요. 앱이 알아서 답글을 보내는 기능은 없습니다.
- **맥이 켜져 있고 깨어 있을 때만** 새 댓글을 가져와요. 최근 글 20개의 댓글을 봅니다.
- **만드는 것:** `~/.threads-replies`(앱·Node.js·기록·내 자료·로그), 로그인 자동 실행 설정 1개, 응용 프로그램 폴더의 실행 아이콘 1개, 원문 캡처용 브라우저. 다시 설치해도 중복으로 생기지 않고, 업데이트해도 기록과 내 자료는 유지돼요.
- **시험한 것:** Apple Silicon 맥(macOS 26.4)에서 가짜 스레드 서버로 연결, 댓글 가져오기, 말투 만들기(규칙책 자동 작성), 초안 쓰기, 답글 보내기, 같이 만든 답 저장, 모두 건너뛰기를 끝까지 돌렸어요. 캡처 이미지 올리기·지우기는 실제 Cloudflare 계정으로 시험했어요. GitHub Actions의 새 맥에서 설치·응답·재설치·제거를, 리눅스에서 가짜 서버 전체 흐름을 매번 시험합니다.
- **시험하지 않은 것:** 이 앱으로 **실제 스레드 계정**을 연결하고 답글을 보내는 것, Aside 연결 스크립트를 처음 쓰는 메타 계정으로 끝까지 돌리는 것은 아직 시험하지 않았어요. 답글 발송과 근거 찾기 코드는 만든 사람의 다른 앱에서 실제 계정으로 쓰던 코드를 옮겼습니다. Intel 맥과 macOS 13 이하도 확인하지 않았어요.
- **회사 노트북**에서는 보안 정책이 백그라운드 실행이나 메타 개발자 등록을 막을 수 있어요. 개인 컴퓨터를 권장합니다.

### 맥이 아닌 컴퓨터

설치 스크립트는 macOS 전용이라 윈도우·리눅스에서는 아무것도 바꾸지 않고 멈춰요. Node.js 22를 직접 설치한 개발자라면 `npm ci && npm run build && npm start`로 실행할 수 있지만, **이 방법은 시험하지 않았어요.**

## 업데이트 · 제거

- 업데이트: 설치 방법을 한 번 더 실행하면 돼요. 기록, 내 자료, 연결은 그대로 남아요.
- 제거: `bash ~/.threads-replies/app/uninstall.sh`. 앱, 기록, 내 자료, 토큰, 자동 실행 설정을 모두 지워요. 내 자료를 남기려면 먼저 `~/.threads-replies/data/내 자료` 폴더를 다른 곳에 복사해 두세요. 메타 앱과 Cloudflare 프로젝트는 각 사이트에서 직접 지울 수 있어요.

## 파일 구성

| 파일 | 하는 일 |
| --- | --- |
| `install.sh` · `uninstall.sh` | 설치(Node.js·앱·자동 실행·캡처 브라우저)와 제거 |
| `scripts/connect-with-aside.sh` · `docs/connect-playbook.md` | AI(Aside)에게 스레드 연결을 맡기는 스크립트와 순서서 |
| `scripts/login-cloudflare.sh` | 캡처 첨부용 Cloudflare 로그인 (선택) |
| `src/lib/account.ts` | 붙여넣은 토큰을 스레드에 물어 검증하고 저장 |
| `src/lib/voice-build.ts` · `src/lib/voice-stats.ts` | 내 지난 답글로 말투 규칙책 만들기 |
| `src/lib/threads-replies/` | 댓글 동기화, 근거 찾기, 초안, 발송, 같이 만든 답 |
| `src/lib/share/ephemeral-media.ts` | 캡처 이미지를 잠깐 공개했다가 지우기 |
| `scripts/fake-threads.mjs` · `scripts/e2e-fake.sh` | 가짜 스레드 서버와 끝까지 시험 |

### 개발자용

```bash
npm ci
npm test                          # 단위 시험
node scripts/fake-threads.mjs     # 가짜 스레드 서버 (다른 터미널에서)
THREADS_GRAPH_BASE_URL=http://127.0.0.1:4568/v1.0 npm run dev
```

가짜 서버 토큰은 `scripts/fake-threads.mjs` 맨 위에 있어요.
