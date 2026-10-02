import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/toast";

export const metadata: Metadata = {
  title: "스레드 답글",
  description: "스레드 댓글에 내 말투로 답글 초안을 쓰고, 근거를 찾아 붙여 보냅니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        {children}
        {/* 알림 한 줄 (동기화 완료·보내기 결과) — 루트에 하나 */}
        <Toaster />
      </body>
    </html>
  );
}
