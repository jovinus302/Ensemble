import type { ReactNode } from "react";
import "./globals.css";
// 작업 흐름별 스타일(Pages v2.5): 캔버스·LOG(B), 채팅 카드·모바일 미리보기(C).
import "./work-context.css";
import "./pages-preview.css";

export const metadata = {
  title: "Ensemble",
  description: "An AI project manager for teams of people and agents.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
