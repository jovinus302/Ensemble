import type { ReactNode } from "react";

export const metadata = {
  title: "Ensemble",
  description: "An AI project manager for teams of people and agents.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
