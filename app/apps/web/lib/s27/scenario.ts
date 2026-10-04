import type { ArtifactSection, ContextEdge, ContextNode, S27Scenario } from './types';

const decisions = ['d-message', 'd-target', 'd-constraint'];
const sources = ['src-guide', 'src-s26', 'src-spec', 'src-legal'];
const meeting = 'S27 캠페인 킥오프';
const launch = '#s27-launch';
const review = '#brand-review';
const sectionsV1: ArtifactSection[] = [
  { label: '메타 피드 A', body: '밤에도 선명한 우리\n퇴근 후 만난 친구의 표정까지 그대로.', grounds: ['d-message', 'd-target', 'src-spec'], image: '/s27/ad-a.jpg' },
  { label: '메타 피드 B', body: '압도적인 배터리\n하루 종일 가는 배터리로 밤까지 선명하게.', grounds: ['d-message', 'd-target', 'd-constraint', 'src-spec', 'src-legal'], image: '/s27/ad-b.jpg' },
  { label: '메타 피드 C', body: '오늘 밤, 주인공은 너\n골목 조명 아래 자연스러운 한 컷.', grounds: ['d-message', 'd-target', 'src-guide'], image: '/s27/ad-c.jpg' },
  { label: '숏폼 15초 스크립트', body: '0–3초: 도시 야경 와이드 숏\n3–7초: 친구들이 만나는 장면\n7–12초: 밤에도 선명한 인물 컷\n12–15초: 사전예약 10/20 시작', grounds: ['d-message', 'd-target', 'd-constraint', 'src-s26', 'src-spec'], image: '/s27/short-v10.jpg' },
];
const sectionsV11: ArtifactSection[] = [
  { label: '메타 피드 A', body: '밤에도 또렷한 너의 미소\n늦은 만남, 반가운 표정을 그대로 남겨요.', grounds: [...decisions, 'src-spec', 'fb-brand', 'fb-legal'], image: '/s27/ad-a.jpg' },
  { label: '메타 피드 B', body: '하루의 끝까지 함께\n하루 종일 가는 배터리*, 밤의 미소까지.\n* 측정 조건: 스펙 시트 시험 기준, 사용 환경별 상이', grounds: [...decisions, 'src-spec', 'src-legal', 'fb-legal', 'fb-brand'], image: '/s27/ad-b.jpg' },
  { label: '메타 피드 C', body: '함께라 더 좋은 밤\n익숙한 골목도 함께라면 특별해져요.', grounds: [...decisions, 'src-guide', 'fb-brand', 'fb-legal'], image: '/s27/ad-c.jpg' },
  { label: '숏폼 15초 스크립트', body: '0–3초: 인물 클로즈업, 미소\n3–7초: 서로 인사하며 한 컷\n7–12초: 밤에도 또렷한 미소\n12–15초: 사전예약 10/20 시작', grounds: [...decisions, 'src-s26', 'src-spec', 'fb-brand', 'fb-legal'], image: '/s27/short-v11.jpg' },
];

const nodes: ContextNode[] = [
  { id: 'src-guide', kind: 'source', title: 'S27 브랜드 가이드 v3', short: '브랜드 가이드', summary: '자신감 있되 과장 없이. 비교·최상급 단정 금지.', origin: 'hub', place: '팀 공유 자료', actorId: 'seoa', at: '9/30 10:00' },
  { id: 'src-s26', kind: 'source', title: 'S26 캠페인 성과 리포트', short: 'S26 리포트', summary: '숏폼 CTR이 배너보다 높고 2030 반응이 최고(가상).', origin: 'hub', place: '팀 공유 자료', actorId: 'junho', at: '9/30 10:10' },
  { id: 'src-spec', kind: 'source', title: 'S27 제품 스펙 시트', short: '제품 스펙', summary: '나이트 포트레이트, 조건부 배터리 사용시간(가상).', origin: 'hub', place: '팀 공유 자료', actorId: 'harin', at: '9/30 10:20' },
  { id: 'src-legal', kind: 'source', title: '광고 표기 체크리스트', short: '표기 체크리스트', summary: '수치엔 측정 조건 각주, 엠바고 전 가격 금지.', origin: 'hub', place: '팀 공유 자료', actorId: 'minjae', at: '9/30 10:30' },
  { id: 'd-message', kind: 'decision', title: '밤에도 선명한 인물 사진', short: '나이트 포트레이트', summary: '핵심 메시지는 나이트 포트레이트.', origin: 'meeting', place: meeting, actorId: 'harin', at: '10/1 14:10' },
  { id: 'd-target', kind: 'decision', title: '2030 · 메타 피드 + 유튜브 숏폼', short: '2030·숏폼', summary: '2030 대상, 메타 피드와 유튜브 숏폼 우선.', origin: 'meeting', place: meeting, actorId: 'harin', at: '10/1 14:15' },
  { id: 'd-constraint', kind: 'decision', title: '비교 금지 · 측정 조건 각주 · 엠바고', short: '비교 금지·각주', summary: '비교 금지, 수치엔 각주, 10/20 전 가격 금지.', origin: 'meeting', place: meeting, actorId: 'harin', at: '10/1 14:20' },
  { id: 'req-draft', kind: 'request', title: '메타 피드 3종 + 숏폼 초안 요청', short: '초안 요청', summary: '킥오프 결정대로 소재 초안 요청.', origin: 'slack', place: launch, actorId: 'junho', at: '10/2 09:00' },
  { id: 'tool-s26', kind: 'tool_run', title: 'S26 성과 리포트 조회', short: '리포트 조회', summary: '숏폼 포맷·2030 반응 추출(시뮬레이션).', origin: 'hub', place: '공유 도구 실행', actorId: 'copy', at: '10/2 09:02' },
  { id: 'tool-check', kind: 'tool_run', title: '브랜드·법무 표기 검사', short: '표기 검사', summary: '금지 표현 0건 — 누락은 법무 검토에서 보완.', origin: 'hub', place: '공유 도구 실행', actorId: 'copy', at: '10/2 09:03' },
  { id: 'art-v1', kind: 'artifact', title: 'S27 사전예약 소재 v1.0', short: '소재 v1.0', summary: '메타 피드 A/B/C와 숏폼 15초 초안.', origin: 'slack', place: launch, actorId: 'copy', at: '10/2 09:05', version: 'v1.0', sections: sectionsV1 },
  { id: 'fb-legal', kind: 'feedback', title: '법무: 각주 추가와 최상급 삭제', short: '법무 의견', summary: 'B안 배터리에 각주, 최상급 표현 삭제.', origin: 'slack', place: review, actorId: 'minjae', at: '10/3 10:00' },
  { id: 'fb-brand', kind: 'feedback', title: '브랜드: 따뜻한 톤과 인물 오프닝', short: '브랜드 의견', summary: '톤은 따뜻하게, 숏폼은 인물 클로즈업으로 시작.', origin: 'slack', place: review, actorId: 'seoa', at: '10/3 10:02' },
  { id: 'req-revise', kind: 'request', title: '법무·브랜드 의견 반영 요청', short: '수정 요청', summary: '서아가 같은 맥락에서 수정 요청.', origin: 'slack', place: review, actorId: 'seoa', at: '10/3 10:02' },
  { id: 'art-v11', kind: 'artifact', title: 'S27 사전예약 소재 v1.1', short: '소재 v1.1', summary: 'v1.0과 피드백 2건 반영, 결정 3건 유지.', origin: 'slack', place: review, actorId: 'copy', at: '10/3 10:05', version: 'v1.1', supersedes: 'art-v1', sections: sectionsV11, changes: ['B안 측정 조건 각주', '최상급 표현 제거', '따뜻한 톤으로 조정', '숏폼 인물 클로즈업 시작', '킥오프 결정 3건 유지'] },
];

const edges: ContextEdge[] = [
  { from: 'src-spec', to: 'd-message', relation: 'grounds' },
  { from: 'src-s26', to: 'd-message', relation: 'grounds' },
  { from: 'src-s26', to: 'd-target', relation: 'grounds' },
  { from: 'src-guide', to: 'd-constraint', relation: 'grounds' },
  { from: 'src-legal', to: 'd-constraint', relation: 'grounds' },
  ...['art-v1', 'art-v11'].flatMap(to => decisions.map(from => ({ from, to, relation: from === 'd-constraint' ? 'constrains' as const : 'grounds' as const }))),
  ...['tool-s26', 'tool-check', 'art-v1'].map(to => ({ from: 'req-draft', to, relation: 'requested' as const })),
  ...['tool-s26', 'tool-check'].map(from => ({ from, to: 'art-v1', relation: 'used' as const })),
  ...['fb-legal', 'fb-brand'].flatMap(from => [{ from, to: 'art-v1', relation: 'feedback_on' as const }, { from, to: 'art-v11', relation: 'grounds' as const }]),
  { from: 'art-v11', to: 'art-v1', relation: 'revises' },
  // The prior version is also input to the revision, so directional upstream traversal includes it.
  { from: 'art-v1', to: 'art-v11', relation: 'grounds' },
  { from: 'req-revise', to: 'art-v11', relation: 'requested' },
];

export const S27: S27Scenario = {
  team: { name: 'S27 런칭 마케팅팀', goal: 'S27 사전예약(10/20–11/2) 온라인 퍼포먼스 마케팅 소재의 방향 설정부터 드래프트까지' },
  actors: [
    { id: 'harin', name: '김하린', role: '마케팅 리드 · 결정권자', kind: 'human', initials: '하린', avatar: '/s27/avatar-harin.jpg' },
    { id: 'junho', name: '박준호', role: '퍼포먼스 마케터', kind: 'human', initials: '준호', avatar: '/s27/avatar-junho.jpg' },
    { id: 'seoa', name: '이서아', role: '브랜드 매니저', kind: 'human', initials: '서아', avatar: '/s27/avatar-seoa.jpg' },
    { id: 'minjae', name: '정민재', role: '법무·광고 심의', kind: 'human', initials: '민재', avatar: '/s27/avatar-minjae.jpg' },
    { id: 'ensemble', name: 'Ensemble', role: '팀에 초대된 앙상블 에이전트', kind: 'agent', initials: 'E' },
    { id: 'copy', name: '카피 Agent', role: '앙상블이 배정한 실행 에이전트', kind: 'agent', initials: 'C' },
  ],
  nodes, edges,
  lines: [
    { id: 'line-open', surface: 'meeting', place: meeting, actorId: 'harin', at: '10/1 14:00', text: '스펙이랑 S26 리포트 보니, 밤 인물 사진으로 가죠.', kind: 'message', refs: ['src-spec', 'src-s26'] },
    { id: 'line-target', surface: 'meeting', place: meeting, actorId: 'junho', at: '10/1 14:10', text: '좋아요, 2030 대상 메타 피드랑 숏폼부터 해요.', kind: 'message', refs: ['d-message', 'd-target', 'src-s26'] },
    { id: 'line-constraint', surface: 'meeting', place: meeting, actorId: 'seoa', at: '10/1 14:15', text: '비교·과장은 빼고, 수치엔 조건 각주 꼭 붙여 주세요.', kind: 'message', refs: ['d-constraint', 'src-guide', 'src-legal'] },
    { id: 'line-capture', surface: 'meeting', place: meeting, actorId: 'ensemble', at: '10/1 14:20', text: '결정 3건을 근거 자료 4건과 함께 기록했어요.', kind: 'capture', refs: [...decisions, 'src-legal'] },
    { id: 'line-request', surface: 'slack', place: launch, actorId: 'junho', at: '10/2 09:00', text: '@Ensemble 킥오프 결정대로 피드 3종, 숏폼 하나 부탁해요.', kind: 'message', refs: ['req-draft'] },
    { id: 'line-pickup', surface: 'slack', place: launch, actorId: 'ensemble', at: '10/2 09:01', text: '킥오프 결정 3건과 가이드 v3로 시작할게요. 가격은 빼둘게요.', kind: 'message', refs: [...decisions, 'src-guide'] },
    { id: 'line-tools', surface: 'slack', place: launch, actorId: 'copy', at: '10/2 09:03', text: 'S26 리포트 조회하고 표기 검사까지 돌렸어요.', kind: 'message', refs: ['tool-s26', 'tool-check'] },
    { id: 'line-v1', surface: 'slack', place: launch, actorId: 'ensemble', at: '10/2 09:05', text: '초안 v1.0이에요. 문장마다 근거를 열어볼 수 있어요.', kind: 'artifact', refs: [...decisions, 'art-v1'] },
    { id: 'line-legal', surface: 'slack', place: review, actorId: 'minjae', at: '10/3 10:00', text: 'B안 배터리엔 측정 조건 각주를, ‘압도적’은 빼 주세요.', kind: 'message', refs: ['fb-legal', 'art-v1'] },
    { id: 'line-revise', surface: 'slack', place: review, actorId: 'seoa', at: '10/3 10:02', text: '@Ensemble 법무 의견 반영, 톤은 따뜻하게, 첫 컷은 인물로.', kind: 'message', refs: ['req-revise', 'fb-legal', 'fb-brand'] },
    { id: 'line-inherit', surface: 'slack', place: review, actorId: 'ensemble', at: '10/3 10:03', text: '최신 v1.0과 킥오프 결정 3건 이어서 고칠게요.', kind: 'message', refs: [...decisions, 'art-v1'] },
    { id: 'line-v11', surface: 'slack', place: review, actorId: 'ensemble', at: '10/3 10:05', text: 'v1.1이에요. 결정은 그대로, 피드백 2건 반영했어요.', kind: 'artifact', refs: ['d-constraint', 'fb-legal', 'fb-brand', 'art-v11'] },
    { id: 'line-notify', surface: 'slack', place: launch, actorId: 'ensemble', at: '10/3 10:06', text: '@박준호 요청하신 소재, v1.1로 갱신됐어요.', kind: 'artifact', refs: ['req-draft', 'art-v11'] },
  ],
  beats: [
    { id: 'beat-01', stage: 1, title: '공유 자료로 시작', headline: '자료는 이미 허브에', caption: '앙상블이 미팅에 함께합니다. 팀 자료는 이미 허브에 있습니다.', focus: 'meeting', lines: ['line-open'], nodes: sources, capabilities: ['cap-meeting', 'cap-permission'] },
    { id: 'beat-02', stage: 1, title: '메시지와 타깃 결정', headline: '결정은 미팅에서', caption: '사람이 메시지와 채널을 정하고, 자료가 근거로 붙습니다.', focus: 'meeting', lines: ['line-target'], nodes: ['d-message', 'd-target'], highlight: 'd-message', capabilities: ['cap-meeting', 'cap-decision'] },
    { id: 'beat-03', stage: 1, title: '제약까지 기록', headline: '근거와 함께 기록', caption: '결정은 회의록에 묻히지 않고 다음 요청에 다시 쓰입니다.', focus: 'meeting', lines: ['line-constraint', 'line-capture'], nodes: ['d-constraint'], highlight: 'd-constraint', capabilities: ['cap-meeting', 'cap-decision', 'cap-ledger'] },
    { id: 'beat-04', stage: 2, title: '짧은 요청', headline: '설명 없이 요청', caption: '다음 날 준호는 배경 설명 없이 평소 채널에서 한 줄로 요청합니다.', focus: 'slack', lines: ['line-request'], nodes: ['req-draft'], capabilities: ['cap-slack'] },
    { id: 'beat-05', stage: 2, title: '맥락을 이어받기', headline: '알아서 이어받기', caption: '앙상블이 이어받은 결정과 자료를 먼저 밝힙니다. 채널 연결은 시뮬레이션.', focus: 'slack', lines: ['line-pickup'], nodes: [], capabilities: ['cap-slack', 'cap-crosschannel', 'cap-channel'] },
    { id: 'beat-06', stage: 3, title: '공유 도구 실행', headline: '도구 실행도 기록', caption: '어떤 도구로 무엇을 검사했는지도 연결됩니다. 누락은 사람이 보완합니다.', focus: 'slack', lines: ['line-tools'], nodes: ['tool-s26', 'tool-check'], highlight: 'tool-check', capabilities: ['cap-tools', 'cap-ledger'] },
    { id: 'beat-07', stage: 3, title: '첫 드래프트', headline: '근거까지 한 번에', caption: '피드 3종과 숏폼이 근거와 함께 도착합니다. 아직 검토 전 초안입니다.', focus: 'slack', lines: ['line-v1'], nodes: ['art-v1'], highlight: 'art-v1', capabilities: ['cap-artifact'] },
    { id: 'beat-08', stage: 4, title: '왜 이 문장인가', headline: '문장 → 결정 → 자료', caption: '섹션을 누르면 요청·도구·결정·자료까지 근거를 따라갑니다.', focus: 'hub', lines: [], nodes: [], highlight: 'art-v1', capabilities: ['cap-provenance', 'cap-ledger'] },
    { id: 'beat-09', stage: 5, title: '다른 채널의 검토', headline: '피드백도 맥락', caption: '다른 채널에서 법무가 검토합니다. 피드백도 결과물에 연결됩니다.', focus: 'slack', lines: ['line-legal'], nodes: ['fb-legal'], highlight: 'fb-legal', capabilities: ['cap-slack', 'cap-artifact'] },
    { id: 'beat-10', stage: 5, title: '다른 사람이 이어서 요청', headline: '다른 채널, 같은 맥락', caption: '서아는 파일 위치도 킥오프 배경도 설명하지 않습니다.', focus: 'slack', lines: ['line-revise', 'line-inherit'], nodes: ['fb-brand', 'req-revise'], capabilities: ['cap-slack', 'cap-crosschannel'] },
    { id: 'beat-11', stage: 5, title: 'v1.1과 원래 요청자 알림', headline: 'v1.1 — 피드백 반영', caption: '수정본을 올리고 준호의 원래 요청에도 알립니다. 이력은 하나입니다.', focus: 'slack', lines: ['line-v11', 'line-notify'], nodes: ['art-v11'], highlight: 'art-v11', capabilities: ['cap-slack', 'cap-crosschannel', 'cap-artifact'] },
    { id: 'beat-12', stage: 5, title: '다음 작업의 자산', headline: '쌓일수록 강해진다', caption: 'v1.1에 이전 버전·피드백·결정이 함께 남습니다. 지표는 시나리오 가정입니다.', focus: 'hub', lines: [], nodes: [], highlight: 'art-v11', capabilities: ['cap-provenance', 'cap-ledger', 'cap-permission'] },
  ],
  capabilities: [
    { id: 'cap-meeting', label: '미팅 에이전트 참여', availability: 'planned', note: '실제 미팅 연결은 추가 개발 필요. 화면은 시뮬레이션입니다.' },
    { id: 'cap-slack', label: '슬랙에서 호출', availability: 'planned', note: '실제 슬랙 호출은 추가 개발 필요. 대화는 미리 작성됨.' },
    { id: 'cap-channel', label: '자체 채널 대화', availability: 'implemented', note: '자체 앱의 메시지·작성 UI는 구현됨. 외부 연동과는 별개.', evidence: ['app/apps/web/components/Message.tsx', 'app/apps/web/components/Composer.tsx'] },
    { id: 'cap-decision', label: '결정 요청·기록', availability: 'implemented', note: '자체 앱에서 결정 요청 카드와 결정 처리를 제공합니다.', evidence: ['app/apps/web/components/DecisionRequestCard.tsx'] },
    { id: 'cap-ledger', label: '이벤트 기록 보존', availability: 'implemented', note: '이벤트 저장소는 구현됨. 이 데모는 서버에 기록하지 않음.', evidence: ['app/packages/store/src/sqlite.ts'] },
    { id: 'cap-artifact', label: '결과물·수정 이력', availability: 'implemented', note: '결과물 첨부·수정·검토는 구현됨. 데모 소재는 가상.', evidence: ['app/apps/web/components/Message.tsx', 'app/apps/web/components/TaskResolution.tsx', 'app/packages/orchestrator/src/dispatch.ts'] },
    { id: 'cap-provenance', label: '섹션 근거 추적', availability: 'demoable', note: '고정된 노드·관계로 시연. 실제 데이터 자동 추출은 아님.' },
    { id: 'cap-crosschannel', label: '채널 간 맥락 이어받기', availability: 'demoable', note: '고정 시나리오가 최신 버전·결정을 선택. 실제 통합 아님.' },
    { id: 'cap-tools', label: '도구 실행 기록', availability: 'demoable', note: '로컬 데이터로 기록을 보여줌. 실제 도구는 호출하지 않음.' },
    { id: 'cap-permission', label: '권한별 맥락 제공', availability: 'planned', note: '팀·사용자 권한별 맥락·도구 제공은 추가 개발 필요.' },
  ],
  metrics: [
    { id: 'm-reexplain', label: '배경 재설명 횟수', legacy: '채널마다 다시 설명', ensemble: '0회', verification: '인수인계 실험에서 재설명 발화 수 비교' },
    { id: 'm-search', label: '자료 탐색·전달', legacy: '링크 찾아 붙여넣기', ensemble: '에이전트가 인용', verification: '자료 탐색·전달 시간 측정' },
    { id: 'm-rework', label: '인수인계 후 재작업', legacy: '옛 버전으로 재작업', ensemble: '최신 버전 자동 연결', verification: '후속 수정에서 잘못된 버전 사용 비율' },
    { id: 'm-trace', label: '결정 근거 추적', legacy: '회의록 수동 검색', ensemble: '클릭으로 추적', verification: '근거 질문에 답하는 시간·정확도' },
  ],
};
