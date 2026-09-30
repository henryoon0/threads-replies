// 내가 단 답글 기록 (말 번복 방지용 참고). Threads 에서 읽기만 한다.
// 첫 동기화는 최대 MAX 개, 그 뒤로는 가장 최근 id 를 만날 때까지만 새로 받는다.
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { listMyReplies } from "./graph";
import { threadsRepliesDir } from "./storage";

export interface MyReply {
  id: string;
  text: string;
  timestamp: string;
  permalink?: string;
  repliedToId?: string;
  rootPostId?: string;
}

interface Store {
  syncedAt?: string;
  items: MyReply[];
}

const MAX = 2000;
const STALE_MS = 30 * 60_000;

function storePath(): string {
  return path.join(threadsRepliesDir(), "my-replies.json");
}

async function readStore(): Promise<Store> {
  try {
    return JSON.parse(await readFile(storePath(), "utf8")) as Store;
  } catch {
    return { items: [] };
  }
}

export type MyRepliesResult = { items: MyReply[]; syncedAt?: string; error?: string };

/** 저장본을 돌려주고, 오래됐으면 새 답글만 이어 받는다. 받기 실패는 저장본 + error 로 돌려준다. */
export async function readMyReplies(nowMs = Date.now()): Promise<MyRepliesResult> {
  const store = await readStore();
  const fresh = store.syncedAt && nowMs - Date.parse(store.syncedAt) < STALE_MS;
  if (fresh) return store;
  try {
    const raw = await listMyReplies(MAX, store.items[0]?.id);
    const added: MyReply[] = raw
      .filter((r) => r.text)
      .map((r) => ({
        id: r.id,
        text: r.text ?? "",
        timestamp: r.timestamp ?? "",
        permalink: r.permalink,
        repliedToId: r.replied_to?.id,
        rootPostId: r.root_post?.id,
      }));
    const next: Store = { syncedAt: new Date(nowMs).toISOString(), items: [...added, ...store.items].slice(0, MAX) };
    await mkdir(threadsRepliesDir(), { recursive: true });
    await writeFile(storePath(), JSON.stringify(next));
    return next;
  } catch (error) {
    return { ...store, error: error instanceof Error ? error.message : String(error) };
  }
}
