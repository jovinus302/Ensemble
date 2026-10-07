import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Ensemble",
  description: "PM Agent — 여러 사람과 Agent의 맥락을 연결하고 다음 행동을 조율합니다.",
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
