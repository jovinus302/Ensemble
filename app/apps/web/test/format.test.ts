import { describe, expect, it } from "vitest";
import { availabilityLabel, formatDays, formatElapsed, formatHourRange, formatHours, formatShortDate, koreanOr, round1, sceneLabel, spanLabel, statusInfo } from "../components/format";
import { readError } from "../components/use-view-model";

describe("숫자 표기", () => {
  it("원시 소수를 사람이 읽는 값으로 줄인다", () => {
    expect(formatDays(4.859469270833335)).toBe("약 5일");
    expect(formatDays(2)).toBe("2일");
    expect(formatDays(1.25)).toBe("1.3일");
    expect(formatDays(0.25)).toBe("약 6시간");
    expect(formatHours(2.5387443452380962)).toBe("2.5시간");
    expect(formatHours(17.5)).toBe("약 18시간");
    expect(formatHours(8)).toBe("8시간");
    expect(round1(0.4166666666666667)).toBe("0.4");
    expect(formatHourRange(3, 5)).toBe("3~5시간");
    expect(formatHourRange(4.01, 4.02)).toBe("4시간");
  });

  it("일정 막대 라벨은 D+소수 대신 날짜로 쓴다", () => {
    const origin = "2026-10-14T15:00:00Z"; // 서울 10/15 00:00
    expect(formatShortDate(origin)).toBe("10/15");
    expect(spanLabel(origin, 0, 8, 8)).toBe("10/15~10/23");
    expect(spanLabel(origin, 0.1666, 0.3333, 0.4)).toBe("10/15");
    expect(spanLabel(origin, 0, 8, 10)).toBe("10/15~10/23 (최대 10/25)");
    // 기준 시각이 없으면(옛 서버) 반올림한 일수로.
    expect(spanLabel(undefined, 0, 0.16666666666666666, 0.3333333333333333)).toBe("D0–0.2~0.3");
  });

  it("가용 시간은 기본값과 이번 주 예외를 구분한다", () => {
    expect(availabilityLabel(8, 4)).toBe("이번 주 4시간(기본 8시간)");
    expect(availabilityLabel(8, undefined)).toBe("8시간/주");
    expect(availabilityLabel(undefined, 4)).toBe("이번 주 4시간(기본 미입력)");
    expect(availabilityLabel(undefined, undefined)).toBe("미입력");
  });

  it("경과 시간", () => {
    expect(formatElapsed(12_400)).toBe("12초");
    expect(formatElapsed(185_000)).toBe("3분 5초");
    expect(formatElapsed(3_720_000)).toBe("1시간 2분");
  });
});

describe("상태·문구", () => {
  it("작업 상태는 한 표에서 한국어로", () => {
    for (const status of ["waiting", "ready", "reserved", "running", "submitted", "revising", "checked", "blocked", "cancelled"]) {
      expect(statusInfo(status).label).toMatch(/[가-힣]/);
    }
    expect(statusInfo("checked").label).toBe("확인됨");
    expect(statusInfo("mystery").label).toBe("mystery");
  });

  it("시나리오 이름의 내부 키를 숨긴다", () => {
    expect(sceneLabel("scene-1-3-continuous · 장면 2")).toBe("장면 2");
    expect(sceneLabel("scene-1-3")).toBe("시나리오");
  });

  it("오류 응답은 한국어 message만 보이고, 영어 원문은 일반 문구로 바꾼다", () => {
    expect(readError({ error: { code: "project_exists", message: "진행 중인 프로젝트가 있어요." } })).toEqual({ code: "project_exists", message: "진행 중인 프로젝트가 있어요." });
    expect(readError({ error: "Invalid JSON" }).message).toMatch(/[가-힣]/);
    expect(readError({ error: "Invalid JSON" }).message).not.toContain("Invalid");
    expect(readError(null).message).toMatch(/[가-힣]/);
    expect(koreanOr("Failed to fetch", "연결 실패")).toBe("연결 실패");
  });
});
