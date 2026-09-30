// 서버 렌더와 브라우저 렌더가 같은 글자를 내도록 시간대를 서울로 고정한다.
const dateFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
const partsFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });
const DAY_MS = 24 * 60 * 60 * 1000;

export function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : timeFmt.format(d);
}

/** "10/15" 형태(서울 기준). */
export function formatShortDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  const parts = partsFmt.formatToParts(d);
  return `${parts.find(p => p.type === "month")?.value}/${parts.find(p => p.type === "day")?.value}`;
}

/** 일정 막대의 n일째를 날짜로. */
export function dayToDate(origin: string, day: number): Date {
  return new Date(new Date(origin).getTime() + day * DAY_MS);
}

/** 소수는 한 자리까지만, 끝의 .0은 뗀다. */
export function round1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? "0" : String(r);
}

/** 일수: 1일 미만은 시간, 3일 이상은 "약 N일", 그 사이는 소수 한 자리. */
export function formatDays(days: number): string {
  if (!Number.isFinite(days)) return "";
  if (days > 0 && days < 1) return `약 ${Math.max(1, Math.round(days * 24))}시간`;
  if (Number.isInteger(days)) return `${days}일`;
  if (days >= 3) return `약 ${Math.round(days)}일`;
  return `${round1(days)}일`;
}

/** 시간: 소수 한 자리까지. 10시간 이상은 "약 N시간". */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return "";
  if (Number.isInteger(hours)) return `${hours}시간`;
  if (hours >= 10) return `약 ${Math.round(hours)}시간`;
  return `${round1(hours)}시간`;
}

/** 범위: "3~5시간", 반올림 뒤 같으면 한 값. */
export function formatHourRange(min: number, max: number): string {
  const a = round1(min), b = round1(max);
  return a === b ? formatHours(min) : `${a}~${b}시간`;
}

/** 날짜 범위: "10/15~10/23", 같은 날이면 한 값. */
export function formatDateRange(from: string | Date, to: string | Date): string {
  const a = formatShortDate(from), b = formatShortDate(to);
  return a === b ? a : `${a}~${b}`;
}

/** 막대 옆 날짜: 기준 시각이 있으면 "10/15~10/23 (최대 10/25)", 없으면 반올림한 D+일. */
export function spanLabel(origin: string | undefined, start: number, min: number, max: number): string {
  if (origin) {
    const [s, a, b] = [start, min, max].map(d => formatShortDate(dayToDate(origin, d)));
    const base = s === a ? a! : `${s}~${a}`;
    return b !== a ? `${base} (최대 ${b})` : base;
  }
  const a = round1(min), b = round1(max);
  return `D${round1(start)}–${a === b ? a : `${a}~${b}`}`;
}

/** 가용 시간 표기: 이번 주 예외가 있으면 "이번 주 4시간(기본 8시간)". */
export function availabilityLabel(weeklyHours: number | undefined, thisWeek: number | undefined): string {
  const base = weeklyHours === undefined ? "미입력" : `${round1(weeklyHours)}시간`;
  return thisWeek === undefined ? (weeklyHours === undefined ? "미입력" : `${base}/주`) : `이번 주 ${round1(thisWeek)}시간(기본 ${base})`;
}

/** 경과 시간: "12초", "3분 5초", "1시간 2분". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}분 ${s % 60}초` : `${m}분`;
  return m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${Math.floor(m / 60)}시간`;
}

type Tone = "done" | "working" | "needs" | "failed" | "queued";
// 작업 상태 표기는 여기 한 곳에서만 정한다(core TaskStatus + 예전 표기).
const STATUS: Record<string, { label: string; tone: Tone }> = {
  waiting: { label: "대기", tone: "queued" },
  ready: { label: "시작 가능", tone: "needs" },
  reserved: { label: "예약됨", tone: "working" },
  running: { label: "진행 중", tone: "working" },
  submitted: { label: "확인 중", tone: "needs" },
  revising: { label: "보완 중", tone: "needs" },
  checked: { label: "확인됨", tone: "done" },
  blocked: { label: "막힘", tone: "needs" },
  cancelled: { label: "제외", tone: "failed" },
  done: { label: "완료", tone: "done" },
  in_progress: { label: "진행 중", tone: "working" },
  working: { label: "진행 중", tone: "working" },
  failed: { label: "실패", tone: "failed" },
  dropped: { label: "제외", tone: "failed" },
  todo: { label: "대기", tone: "queued" },
  pending: { label: "대기", tone: "queued" },
};

export function statusInfo(status: string) {
  return STATUS[status] ?? { label: status, tone: "queued" as const };
}

export function initial(name: string): string {
  return Array.from(name.trim())[0] ?? "?";
}

/** 한글이 없는 원문(영어 예외 문구 등)은 사람에게 보여 주지 않는다. */
export function koreanOr(message: unknown, fallback: string): string {
  return typeof message === "string" && /[가-힣]/.test(message) ? message : fallback;
}

/** 시나리오 이름에서 내부 키를 떼고 "장면 N"만 남긴다. */
export function sceneLabel(name: string): string {
  return /장면\s*\d+/.exec(name)?.[0] ?? "시나리오";
}
