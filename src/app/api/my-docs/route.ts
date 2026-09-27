import { execFile } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { NextResponse } from "next/server";
import { myDocsDir, myNotesDir } from "@/lib/threads-replies/my-docs-path";

export const dynamic = "force-dynamic";

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) n += await countFiles(`${dir}/${e.name}`);
    else if (/\.(md|markdown|txt)$/i.test(e.name)) n += 1;
  }
  return n;
}

// GET: 내 자료 폴더 위치와 파일 수 · POST: 파인더로 열기
export async function GET() {
  return NextResponse.json({ dir: myDocsDir(), files: await countFiles(myDocsDir()), notes: await countFiles(myNotesDir()) });
}

export async function POST() {
  await mkdir(myDocsDir(), { recursive: true });
  if (process.platform === "darwin") execFile("open", [myDocsDir()]);
  return NextResponse.json({ dir: myDocsDir() });
}
