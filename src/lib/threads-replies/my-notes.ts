// "같이 만든 답" — 근거가 없어 초안 아래 질문(myAsk)에 주인이 답하면, 그 답을 내 자료 폴더에
// 노트로 남긴다. 다음부터 비슷한 질문엔 이 노트가 근거로 잡힌다.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { localDateKey } from "@/lib/date";
import { forgetEvidenceCorpus } from "./evidence-docs";
import { myNotesDir } from "./my-docs-path";

/** 파일 이름에 못 쓰는 글자를 걷어낸 짧은 제목 */
export function noteSlug(text: string): string {
  const s = text
    .normalize("NFC")
    .replace(/[\\/:*?"<>|#\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
  return s || "메모";
}

export async function saveMyNote(input: { question: string; ask?: string; answer: string; now?: Date }): Promise<string> {
  const now = input.now ?? new Date();
  const dir = myNotesDir();
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${localDateKey(now)} ${noteSlug(input.ask || input.question)}.md`);
  const body = [
    `# ${input.ask?.trim() || input.question.trim().split("\n")[0]}`,
    "",
    `받은 질문: ${input.question.trim()}`,
    "",
    input.answer.trim(),
    "",
  ].join("\n");
  await writeFile(file, body);
  forgetEvidenceCorpus();
  return file;
}
