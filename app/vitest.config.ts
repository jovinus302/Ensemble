import { defineConfig } from "vitest/config";

export default defineConfig({
  // 웹 tsconfig는 Next.js용으로 jsx: preserve라서, 테스트에서 컴포넌트를 렌더하려면 여기서 JSX를 변환한다.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/web/test/**/*.test.ts"],
    environment: "node",
  },
});
