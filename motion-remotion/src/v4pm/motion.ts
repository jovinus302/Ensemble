import type {CameraPose} from '../v3/tokens/video';
import {STILL_POSES} from '../v4/config';
import {POSE, type Beat} from './content';

export const DURATION = 1710;
export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const smooth = (n: number) => {const t = clamp(n); return t * t * (3 - 2 * t);};
export const ramp = (frame: number, start: number, duration: number) => smooth((frame - start) / duration);
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const SEGMENTS: {beat: Beat; start: number; end: number}[] = [
  {beat: 'B1', start: 330, end: 450}, {beat: 'B2', start: 450, end: 630},
  {beat: 'B3', start: 630, end: 810}, {beat: 'B4', start: 810, end: 1050},
  {beat: 'B5', start: 1050, end: 1320}, {beat: 'B6', start: 1320, end: 1530},
];
export const segmentAt = (frame: number) => SEGMENTS.find(s => frame >= s.start && frame < s.end) ?? (frame < 330 ? SEGMENTS[0] : SEGMENTS[5]);
export const cameraAt = (frame: number): CameraPose => {
  const o = STILL_POSES.SF1a;
  if (frame < 120) return {...o, ay: 700, s: mix(.72, .8, ramp(frame, 0, 45))};
  if (frame < 180) return o;
  if (frame < 210) {
    const p = ramp(frame, 180, 30);
    const result = {} as CameraPose;
    for (const key of Object.keys(POSE) as (keyof CameraPose)[]) result[key] = mix(o[key], POSE[key], p);
    return result;
  }
  if (frame >= 1530) return {...POSE, s: mix(POSE.s, .94, ramp(frame, 1530, 24))};
  return POSE;
};

export type MessageKind = 'text' | 'team' | 'plan' | 'handoff' | 'impact' | 'change' | 'result';
export type Speaker = '김도윤' | '이서연' | 'AI PM' | '조사 Agent' | '프로토타입 Agent' | '변경 전달';
export interface Message {id: string; from: number; speaker: Speaker; kind: MessageKind; body?: string[]; badge?: string; h: number; title?: string; y: number;}
type Input = Omit<Message, 'y'>;
const inputs: Input[] = [
  {id: 'goal', from: 180, speaker: '김도윤', kind: 'text', h: 106, body: ['2주 안에 이 아이디어의 고객 반응을 확인하자.']},
  {id: 'opening-reply', from: 210, speaker: 'AI PM', kind: 'text', h: 158, body: ['도윤님·서연님, 이번 주 가용 시간을 알려 주세요.', '그 안에서 조사와 인터뷰를 나눌게요.'], badge: '답변 대기'},
  {id: 'team', from: 330, speaker: 'AI PM', kind: 'team', h: 468, title: '사람 둘, 실행 Agent 둘, AI PM', badge: '팀원 5'},
  {id: 'availability', from: 450, speaker: '김도윤', kind: 'text', h: 138, body: ['저는 주 6시간 가능해요.', '목표·시간 안의 배정과 순서 조정은 PM에게 맡길게요.']},
  {id: 'designer-availability', from: 465, speaker: '이서연', kind: 'text', h: 106, body: ['저는 주 8시간 가능해요.']},
  {id: 'plan', from: 480, speaker: 'AI PM', kind: 'plan', h: 468, title: '계획 v1 · 역할과 가용 시간', badge: '함께 시작'},
  {id: 'handoff', from: 630, speaker: 'AI PM', kind: 'handoff', h: 348, title: '맥락 인계 · 조사·인터뷰 → 이서연', badge: '출처 연결'},
  {id: 'question', from: 738, speaker: '프로토타입 Agent', kind: 'text', h: 106, body: ['결제 흐름도 이번 초안에 포함할까요?']},
  {id: 'scope-included', from: 774, speaker: '김도윤', kind: 'text', h: 106, body: ['네, 결제 흐름도 초안에 포함해 주세요.']},
  {id: 'draft-r1', from: 795, speaker: '이서연', kind: 'text', h: 138, body: ['흐름 초안 r1을 올렸어요.'], badge: '초안 첨부'},
  {id: 'missing-input', from: 810, speaker: 'AI PM', kind: 'text', h: 138, body: ['진입 화면이 빠졌어요. 초안에 추가해 주세요.'], badge: '보완 필요'},
  {id: 'draft-r2', from: 870, speaker: '이서연', kind: 'text', h: 158, body: ['진입 화면을 보완했어요. 흐름 초안 r2를 올립니다.', '상세 설계는 이어서 할게요.'], badge: '보완 초안 r2'},
  {id: 'handoff-checked', from: 930, speaker: 'AI PM', kind: 'text', h: 158, body: ['문제 ①과 진입 흐름이 있어 제작할 수 있어요.', '프로토타입 작업을 시작해요.'], badge: '인계 가능'},
  {id: 'agent-started', from: 990, speaker: '프로토타입 Agent', kind: 'text', h: 158, body: ['흐름 초안 r2로 제작을 시작했어요.', '이서연님은 상세 설계를 이어서 진행해요.'], badge: '제작 중'},
  {id: 'holiday', from: 1050, speaker: '이서연', kind: 'text', h: 138, body: ['목요일 휴가예요. 상세는 다음 주에 드릴게요.']},
  {id: 'deadline-question', from: 1095, speaker: '김도윤', kind: 'text', h: 106, body: ['그럼 제작도 늦어지나요?']},
  {id: 'impact', from: 1140, speaker: 'AI PM', kind: 'impact', h: 278, title: '기한 영향 · 선택지 비교', badge: '기한 비교'},
  {id: 'time-commitment', from: 1215, speaker: '이서연', kind: 'text', h: 138, body: ['초안으로 계속해요. 상세는 다음 주에 할게요.']},
  {id: 'scope-excluded', from: 1260, speaker: '김도윤', kind: 'text', h: 106, body: ['결제 흐름은 이번 범위에서 빼죠.']},
  {id: 'change', from: 1320, speaker: 'AI PM', kind: 'change', h: 378, title: '계획 v1 → v2', badge: 'PM 반영'},
  {id: 'update-sent', from: 1400, speaker: '변경 전달', kind: 'text', h: 138, body: ['바뀐 이서연님과 프로토타입 Agent에게 전달했어요.'], badge: '전송됨 · 확인 대기'},
  {id: 'update-ack', from: 1425, speaker: '프로토타입 Agent', kind: 'text', h: 158, body: ['계획 v2 확인했어요. 결제를 빼고 제작을 이어갑니다.'], badge: '변경 확인 · 결과 반영 대기'},
  {id: 'result-r3', from: 1470, speaker: '프로토타입 Agent', kind: 'result', h: 218, title: '수정 결과 · 프로토타입 r3', badge: '계획 v2'},
  {id: 'result-compared', from: 1485, speaker: 'AI PM', kind: 'text', h: 138, body: ['변경 내용과 결과가 일치해요.'], badge: '반영 확인'},
];
let y = 0;
export const MESSAGES: Message[] = inputs.map(m => {const message = {...m, y}; y += m.h + 18; return message;});
export const VIEW = {x: 330, y: 82, w: 700, h: 500};
export const lastMessageAt = (frame: number) => [...MESSAGES].reverse().find(m => m.from <= frame);
const target = (m?: Message) => m ? Math.max(0, m.y + m.h - VIEW.h) : 0;
// 연달아 도착한 발언도 직전 프레임의 스크롤 위치에서 이어진다.
export const scrollAt = (frame: number): number => {
  let index = MESSAGES.length - 1;
  while (index >= 0 && MESSAGES[index].from > frame) index--;
  if (index < 0) return 0;
  const m = MESSAGES[index];
  const previous = index > 0 ? MESSAGES[index - 1] : undefined;
  const previousPosition = previous && m.from - previous.from < 20 ? scrollAt(m.from - 0.001) : target(previous);
  return mix(previousPosition, target(m), ramp(frame, m.from, 20));
};
export const heroAt = (frame: number) => {
  const m = lastMessageAt(frame);
  if (!m || m.kind === 'text' || m.kind === 'result' || frame < m.from + 20) return null;
  const next = MESSAGES[MESSAGES.indexOf(m) + 1]?.from ?? 1530;
  const rise = ramp(frame, m.from + 20, 16) * (1 - ramp(frame, next - 16, 16));
  return {message: m, card: {x: VIEW.x, y: VIEW.y + m.y - scrollAt(frame) + 42, w: VIEW.w, h: m.h - 42}, rise};
};
export const roadmapAt = (frame: number) => ({
  version: frame >= 1320 ? 'v2' : 'v1',
  title: frame >= 990 ? '상세 설계 + 제작' : frame >= 480 ? '조사 + 인터뷰' : '계획 v1 준비',
  detail: frame >= 1320 ? '예상 종료 · 기한 안' : frame >= 1140 ? '상세 대기 시 · 2일 지연' : '예상 종료 · 입력 확인 중',
  status: frame >= 1485 ? '변경 결과 반영 확인' : frame >= 1425 ? 'Agent 결과 반영 대기' : frame >= 1400 ? '전송됨 · 확인 대기' : frame >= 1320 ? '변경 담당자에게 전달 준비' : frame >= 990 ? '초안으로 제작 중' : frame >= 930 ? 'PM · 인계 가능' : frame >= 810 ? '초안 입력 확인' : '다음 입력을 확인해요',
});
