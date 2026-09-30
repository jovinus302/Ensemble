import type { ReactNode } from "react";
import "./globals.css";

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
