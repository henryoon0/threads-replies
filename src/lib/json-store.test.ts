import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { dirStore } from "./json-store";

interface Rec {
  id: string;
  name: string;
}

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dirstore-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

function store() {
  vi.stubEnv("DIRSTORE_TEST_DIR", tmp);
  return dirStore<Rec>({ dir: "dirstore-test", envVar: "DIRSTORE_TEST_DIR" });
}

describe("dirStore 경로 해석", () => {
  it("envVar 가 디렉터리 전체를 오버라이드한다 (호출 시점 지연 해석)", () => {
    const s = store();
    expect(s.dir()).toBe(tmp);
    expect(s.path("abc")).toBe(path.join(tmp, "abc.json"));
  });

  it("envVar 미설정이면 process.cwd()/data/<dir> 기본값", () => {
    const s = dirStore<Rec>({ dir: "dirstore-test", envVar: "DIRSTORE_TEST_UNSET" });
    expect(s.dir()).toBe(path.join(process.cwd(), "data", "dirstore-test"));
  });
});

describe("dirStore.put / get", () => {
  it("put 은 mkdir -p 후 {id}.json 으로 저장하고 get 이 그대로 읽는다", async () => {
    const s = store();
    await s.put("a", { id: "a", name: "하나" });
    expect(await s.get("a")).toEqual({ id: "a", name: "하나" });
  });

  it("없는 id 는 null", async () => {
    expect(await store().get("nope")).toBeNull();
  });

  it("깨진 JSON 은 null (기능을 죽이지 않음)", async () => {
    const s = store();
    await fs.writeFile(path.join(tmp, "bad.json"), "{corrupt", "utf-8");
    expect(await s.get("bad")).toBeNull();
  });

  it("원자적 쓰기 — 저장 후 디렉터리에 tmp 잔여 파일이 없다", async () => {
    const s = store();
    await s.put("a", { id: "a", name: "하나" });
    const files = await fs.readdir(tmp);
    expect(files).toEqual(["a.json"]);
  });

  it("덮어쓰기 — 같은 id 에 put 하면 최신 값", async () => {
    const s = store();
    await s.put("a", { id: "a", name: "하나" });
    await s.put("a", { id: "a", name: "둘" });
    expect((await s.get("a"))?.name).toBe("둘");
  });

  it("같은 밀리초에 같은 id 를 저장해도 각 쓰기가 온전하게 완료된다", async () => {
    const s = store();
    const values = [{ id: "a", name: "하나" }, { id: "a", name: "둘" }];
    vi.spyOn(Date, "now").mockReturnValue(1234);
    const rename = fs.rename.bind(fs);
    let entered = 0;
    let release!: () => void;
    const bothReady = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (++entered === 2) release();
      await bothReady;
      return rename(from, to);
    });

    const results = await Promise.allSettled(values.map((value) => s.put("a", value)));

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(values).toContainEqual(await s.get("a"));
    expect(await fs.readdir(tmp)).toEqual(["a.json"]);
  });
});

describe("dirStore.list", () => {
  it("모든 *.json 을 파싱하고, 깨진 파일과 json 아닌 파일은 건너뛴다", async () => {
    const s = store();
    await s.put("a", { id: "a", name: "하나" });
    await s.put("b", { id: "b", name: "둘" });
    await fs.writeFile(path.join(tmp, "bad.json"), "{corrupt", "utf-8");
    await fs.writeFile(path.join(tmp, "note.txt"), "무시", "utf-8");

    const all = await s.list();
    expect(new Set(all.map((r) => r.id))).toEqual(new Set(["a", "b"]));
  });

  it("디렉터리가 없으면 빈 배열", async () => {
    vi.stubEnv("DIRSTORE_TEST_DIR", path.join(tmp, "does-not-exist"));
    const s = dirStore<Rec>({ dir: "x", envVar: "DIRSTORE_TEST_DIR" });
    expect(await s.list()).toEqual([]);
  });
});

describe("dirStore id 안전성 (path traversal 방어)", () => {
  it("경로 구분자·.. 가 든 id 는 get=null, remove=false, put=throw", async () => {
    const s = store();
    await fs.writeFile(path.join(tmp, "victim.json"), '{"id":"v"}', "utf-8");

    expect(await s.get("../victim")).toBeNull();
    expect(await s.get("a/b")).toBeNull();
    expect(await s.remove("../victim")).toBe(false);
    await expect(s.put("../evil", { id: "e", name: "x" })).rejects.toThrow(
      /잘못된 레코드 id/
    );
    // 방어가 실제로 파일을 지키는지: victim 은 그대로다.
    expect(await s.get("victim")).toEqual({ id: "v" });
  });
});

describe("dirStore.remove", () => {
  it("있으면 지우고 true, 없으면 false", async () => {
    const s = store();
    await s.put("a", { id: "a", name: "하나" });
    expect(await s.remove("a")).toBe(true);
    expect(await s.get("a")).toBeNull();
    expect(await s.remove("a")).toBe(false);
  });
});
