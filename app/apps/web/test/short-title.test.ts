import { describe, expect, it } from "vitest";
import { shortTitle } from "../lib/runtime";

describe("프로젝트 짧은 제목", () => {
  it("짧은 제목은 그대로 둔다", () => {
    expect(shortTitle("  동네 필라테스   예약 앱 ")).toBe("동네 필라테스 예약 앱");
  });
  it("40자를 넘으면 단어 경계에서 자르고 말줄임표를 붙인다", () => {
    const goal = "동네 필라테스 스튜디오 회원이 모바일에서 수업을 예약하고 결제까지 끝내는 서비스 만들기";
    const title = shortTitle(goal);
    expect(title.length).toBeLessThanOrEqual(40);
    expect(title.endsWith("…")).toBe(true);
    expect(goal.startsWith(title.slice(0, -1))).toBe(true);
    expect(goal[title.length - 1]).toBe(" ");
  });
  it("공백 없는 긴 단어는 40자 안에서 자른다", () => {
    const title = shortTitle("가".repeat(60));
    expect(title).toBe("가".repeat(39) + "…");
    expect(title.length).toBe(40);
  });
});
