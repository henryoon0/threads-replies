import path from "node:path";

/** 받는 사람의 자료 폴더. 여기 넣은 .md·.txt 가 답글 근거가 된다. */
export function myDocsDir(): string {
  return process.env.MY_DOCS_DIR ?? path.join(process.cwd(), "data", "내 자료");
}

/** 초안 아래 질문에 답한 내용이 쌓이는 하위 폴더 */
export function myNotesDir(): string {
  return path.join(myDocsDir(), "같이 만든 답");
}
