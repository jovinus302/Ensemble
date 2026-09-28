import type {CameraPose} from '../v3/tokens/video';
import {COPY, STILL_POSES, headlineLength} from '../v4/config';

export const BEATS = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'] as const;
export type Beat = typeof BEATS[number];
export type Still = Beat | 'O1' | 'OH' | 'O2';
export const STILLS: Still[] = ['O1', 'OH', 'O2', ...BEATS];
export const POSE: CameraPose = {tx: 720, ty: 256, s: 1.25, rx: 0, ry: 0, rz: 0, ax: 960, ay: 540, dz: 0};
export const poseFor = (still: Still) => still === 'O1' ? STILL_POSES.SF1a : POSE;
export const CARD = {x: 330, y: 158, w: 700, h: 426};
export const ANCHOR = {x: CARD.x + CARD.w - 32, y: CARD.y + 44};
export const headlines: Record<Beat, string> = {
  B1: '사람과 Agent, 한 채널에',
  B2: '가용 시간을 보고 맡긴다',
  B3: '필요한 맥락을 이어 준다',
  B4: "아무도 '시작해'라고 안 했다",
  B5: '대화가 바뀌면, 계획도',
  B6: '바뀐 일을, 담당자에게',
};
export const labels: Record<Beat, string> = {
  B1: '한 채널의 팀', B2: '병렬로 시작', B3: '결정 이유까지',
  B4: '지시 없이 시작', B5: '필요할 때 한마디', B6: '바뀐 담당자에게',
};
export const titles: Record<Beat, string> = {
  B1: '사람 둘, 실행 Agent 둘, AI PM', B2: '계획 v1 · 역할과 가용 시간',
  B3: '맥락 인계 · 조사·인터뷰 → 이서연', B4: '초안에서 이어지는 작업',
  B5: '조율 스레드 · 초안으로 계속할까요?', B6: '계획 v1 → v2',
};
export const badges: Record<Beat, string> = {
  B1: '팀원 5', B2: '함께 시작', B3: '출처 연결', B4: '제작 중', B5: '선택지 비교', B6: '변경 확인',
};
export const captions: Record<Beat, string> = {
  B1: '목표 · 2주 안에 고객 반응 확인',
  B2: 'AI PM · 역할과 가용 시간을 반영했어요. 조사와 인터뷰를 함께 시작해요.',
  B3: 'AI PM · 결정 이유와 입력을 넘겼어요. 남은 질문은 따로 표시했어요.',
  B4: 'AI PM · 초안으로 제작할 수 있어요. 프로토타입 작업을 시작해요.',
  B5: '김도윤 · 그럼 제작도 늦어지나요?',
  B6: 'AI PM · 정리하면, 초안으로 제작 계속·결제 제외·상세는 다음 주예요.',
};
for (const text of [...Object.values(headlines), ...Object.values(COPY)]) {
  if (headlineLength(text) > 18) throw new Error(`헤드라인 18자 초과: ${text}`);
}
