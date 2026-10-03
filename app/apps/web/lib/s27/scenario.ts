import type { ArtifactSection, ContextEdge, ContextNode, S27Scenario } from './types';

const decisions = ['d-message', 'd-target', 'd-constraint'];
const sources = ['src-guide', 'src-s26', 'src-spec', 'src-legal'];
const meeting = 'S27 캠페인 킥오프';
const launch = '#s27-launch';
const review = '#brand-review';
const sectionsV1: ArtifactSection[] = [
  { label: '메타 피드 A', body: '헤드라인: 밤에도 선명한 우리\n본문: 퇴근 후 만난 친구의 표정까지. S27 나이트 포트레이트로 오늘의 밤을 남기세요.', grounds: ['d-message', 'd-target', 'src-spec'] },
  { label: '메타 피드 B', body: '헤드라인: 하루 종일 가는 배터리\n본문: 압도적 즐거움으로 채운 하루, 밤에는 선명한 인물 사진으로 마무리하세요.', grounds: ['d-message', 'd-target', 'd-constraint', 'src-spec', 'src-legal'] },
  { label: '메타 피드 C', body: '헤드라인: 오늘 밤, 주인공은 너\n본문: 골목의 조명 아래 자연스러운 한 컷. S27과 함께 밤의 표정을 기록하세요.', grounds: ['d-message', 'd-target', 'src-guide'] },
  { label: '숏폼 15초 스크립트', body: '0–3초: 도시 야경 와이드 숏. 자막: 우리의 밤이 시작된다.\n3–7초: 친구들이 만나는 장면, S27로 촬영.\n7–12초: 나이트 포트레이트 인물 사진. 내레이션: 밤에도 선명한 너의 표정.\n12–15초: 제품과 캠페인명. 자막: S27 사전예약 10/20–11/2.', grounds: ['d-message', 'd-target', 'd-constraint', 'src-s26', 'src-spec'] },
];
const sectionsV11: ArtifactSection[] = [
  { label: '메타 피드 A', body: '헤드라인: 밤에도 또렷한 너의 미소\n본문: 늦은 만남이 더 반가운 날. S27 나이트 포트레이트로 소중한 표정을 남겨요.', grounds: [...decisions, 'src-spec', 'fb-brand', 'fb-legal'] },
  { label: '메타 피드 B', body: '헤드라인: 하루의 끝까지, 함께 담아요\n본문: 하루 종일 가는 배터리*와 함께, 반가운 얼굴을 밤에도 선명하게 남겨요.\n* 측정 조건: S27 제품 스펙 시트의 실내 기본 밝기·Wi-Fi 연결·혼합 사용 시험 기준이며, 실제 사용시간은 환경과 사용 방식에 따라 달라집니다.', grounds: [...decisions, 'src-spec', 'src-legal', 'fb-legal', 'fb-brand'] },
  { label: '메타 피드 C', body: '헤드라인: 너와 함께라 더 좋은 밤\n본문: 익숙한 골목도 함께 걸으면 특별해져요. S27으로 오늘 우리의 표정을 간직해요.', grounds: [...decisions, 'src-guide', 'fb-brand', 'fb-legal'] },
  { label: '숏폼 15초 스크립트', body: '0–3초: 인물 클로즈업, 친구를 발견하고 웃는 얼굴. 자막: 만나서 반가워.\n3–7초: 서로 인사하며 S27로 사진을 찍는 장면.\n7–12초: 나이트 포트레이트 인물 사진. 내레이션: 이 밤, 너의 미소를 선명하게.\n12–15초: 제품과 캠페인명. 자막: S27 사전예약 10/20–11/2.', grounds: [...decisions, 'src-s26', 'src-spec', 'fb-brand', 'fb-legal'] },
];

const nodes: ContextNode[] = [
  { id: 'src-guide', kind: 'source', title: 'S27 브랜드 가이드 v3', summary: '자신감 있되 과장 없는 톤. 경쟁사 비교와 최초·유일 등 최상급 단정을 금지합니다.', origin: 'hub', place: '팀 공유 자료', actorId: 'seoa', at: '9/30 10:00' },
  { id: 'src-s26', kind: 'source', title: 'S26 캠페인 성과 리포트', summary: '리포트 기준 15초 숏폼 CTR이 정적 배너보다 높고 2030 전환 반응이 좋았습니다. 데모용 가상 자료입니다.', origin: 'hub', place: '팀 공유 자료', actorId: 'junho', at: '9/30 10:10' },
  { id: 'src-spec', kind: 'source', title: 'S27 제품 스펙 시트', summary: '나이트 포트레이트와 조건부 배터리 사용시간. 실내 기본 밝기·Wi-Fi 연결·혼합 사용 시험을 가정한 데모용 자료입니다.', origin: 'hub', place: '팀 공유 자료', actorId: 'harin', at: '9/30 10:20' },
  { id: 'src-legal', kind: 'source', title: '광고 표기 체크리스트', summary: '수치·사용시간 표현에는 측정 조건 각주가 필요하며 엠바고 전 가격 언급은 금지합니다.', origin: 'hub', place: '팀 공유 자료', actorId: 'minjae', at: '9/30 10:30' },
  { id: 'd-message', kind: 'decision', title: '밤에도 선명한 인물 사진', summary: '핵심 메시지는 나이트 포트레이트입니다. 제품 스펙과 S26 리포트를 근거로 결정했습니다.', origin: 'meeting', place: meeting, actorId: 'harin', at: '10/1 14:10' },
  { id: 'd-target', kind: 'decision', title: '2030 · 메타 피드 + 유튜브 숏폼', summary: 'S26 리포트를 따라 2030 대상 메타 피드와 유튜브 숏폼을 우선합니다.', origin: 'meeting', place: meeting, actorId: 'harin', at: '10/1 14:15' },
  { id: 'd-constraint', kind: 'decision', title: '비교 금지 · 측정 조건 각주 · 엠바고', summary: '경쟁사 비교 금지, 수치에는 측정 조건 각주, 10/20 엠바고 전 가격 언급 금지. 가이드 v3와 법무 체크리스트를 따릅니다.', origin: 'meeting', place: meeting, actorId: 'harin', at: '10/1 14:20' },
  { id: 'req-draft', kind: 'request', title: '메타 피드 3종 + 숏폼 초안 요청', summary: '킥오프 결정대로 소재 초안을 요청했습니다.', origin: 'slack', place: launch, actorId: 'junho', at: '10/2 09:00' },
  { id: 'tool-s26', kind: 'tool_run', title: 'S26 성과 리포트 조회', summary: '숏폼 포맷·2030 반응 문구를 추출했습니다. 로컬 시뮬레이션이며 실제 도구 호출은 없습니다.', origin: 'hub', place: '공유 도구 실행', actorId: 'copy', at: '10/2 09:02' },
  { id: 'tool-check', kind: 'tool_run', title: '브랜드·법무 표기 검사', summary: '검사 로그: 금지 표현 0건, 각주 필요 1건 처리. 이 모의 검사에는 누락이 있어 초안의 최상급·각주가 법무 검토에서 다시 지적됩니다.', origin: 'hub', place: '공유 도구 실행', actorId: 'copy', at: '10/2 09:03' },
  { id: 'art-v1', kind: 'artifact', title: 'S27 사전예약 소재 v1.0', summary: '메타 피드 A/B/C와 숏폼 15초 초안입니다. 법무 검토 전 가상 카피이며 표현·각주 보완이 남아 있습니다.', origin: 'slack', place: launch, actorId: 'copy', at: '10/2 09:05', version: 'v1.0', sections: sectionsV1 },
  { id: 'fb-legal', kind: 'feedback', title: '법무: 각주 추가와 최상급 삭제', summary: 'B안 배터리 표현에 측정 조건 각주가 필요하고 최상급 표현은 삭제해야 합니다.', origin: 'slack', place: review, actorId: 'minjae', at: '10/3 10:00' },
  { id: 'fb-brand', kind: 'feedback', title: '브랜드: 따뜻한 톤과 인물 오프닝', summary: '전체 톤을 더 따뜻하게, 숏폼 첫 3초는 인물 클로즈업으로 조정합니다.', origin: 'slack', place: review, actorId: 'seoa', at: '10/3 10:02' },
  { id: 'req-revise', kind: 'request', title: '법무·브랜드 의견 반영 요청', summary: '서아가 같은 맥락을 이어받아 후속 수정을 요청했습니다.', origin: 'slack', place: review, actorId: 'seoa', at: '10/3 10:02' },
  { id: 'art-v11', kind: 'artifact', title: 'S27 사전예약 소재 v1.1', summary: 'v1.0과 법무·브랜드 피드백을 이어받았습니다. 핵심 메시지·타깃과 채널·제약 결정 3건은 그대로 유지합니다.', origin: 'slack', place: review, actorId: 'copy', at: '10/3 10:05', version: 'v1.1', supersedes: 'art-v1', sections: sectionsV11, changes: ['B안에 측정 조건 각주 추가', '최상급 표현 제거', '전체 카피를 따뜻한 톤으로 조정', '숏폼 첫 3초를 인물 클로즈업으로 변경', '킥오프 결정 3건 유지'] },
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
    { id: 'harin', name: '김하린', role: '마케팅 리드 · 결정권자', kind: 'human', initials: '하린' },
    { id: 'junho', name: '박준호', role: '퍼포먼스 마케터', kind: 'human', initials: '준호' },
    { id: 'seoa', name: '이서아', role: '브랜드 매니저', kind: 'human', initials: '서아' },
    { id: 'minjae', name: '정민재', role: '법무·광고 심의', kind: 'human', initials: '민재' },
    { id: 'ensemble', name: 'Ensemble', role: '팀에 초대된 앙상블 에이전트', kind: 'agent', initials: 'E' },
    { id: 'copy', name: '카피 Agent', role: '앙상블이 배정한 실행 에이전트', kind: 'agent', initials: 'C' },
  ],
  nodes, edges,
  lines: [
    { id: 'line-open', surface: 'meeting', place: meeting, actorId: 'harin', at: '10/1 14:00', text: '공유한 스펙과 S26 리포트를 보고, 이번에는 밤에도 선명한 인물 사진을 중심으로 가죠.', kind: 'message', refs: ['src-spec', 'src-s26'] },
    { id: 'line-target', surface: 'meeting', place: meeting, actorId: 'junho', at: '10/1 14:10', text: '좋아요. 리포트 반응을 보면 2030 대상 메타 피드와 유튜브 숏폼부터 만들면 좋겠어요.', kind: 'message', refs: ['src-s26', 'd-message', 'd-target'] },
    { id: 'line-constraint', surface: 'meeting', place: meeting, actorId: 'seoa', at: '10/1 14:15', text: '브랜드 가이드 v3와 광고 표기 체크리스트도 같이 적용해요. 자신감은 갖되 비교와 과장은 피하고, 수치에는 조건을 붙여 주세요.', kind: 'message', refs: ['src-guide', 'src-legal', 'd-constraint'] },
    { id: 'line-capture', surface: 'meeting', place: meeting, actorId: 'ensemble', at: '10/1 14:20', text: '결정 3건을 앙상블에 기록했고, 근거 자료 4건과 연결했습니다. 나이트 포트레이트 메시지, 2030·메타 피드·숏폼, 비교 금지·각주·엠바고 제약을 스펙·S26 리포트·가이드 v3·광고 표기 체크리스트와 함께 보존합니다.', kind: 'capture', refs: [...decisions, ...sources] },
    { id: 'line-request', surface: 'slack', place: launch, actorId: 'junho', at: '10/2 09:00', text: '@Ensemble 킥오프 결정대로 메타 피드 소재 3종이랑 숏폼 스크립트 하나 초안 부탁해요.', kind: 'message', refs: ['req-draft'] },
    { id: 'line-pickup', surface: 'slack', place: launch, actorId: 'ensemble', at: '10/2 09:01', text: '킥오프의 나이트 포트레이트 메시지, 2030·메타 피드·숏폼, 비교 금지·각주 제약을 이어받았습니다. 브랜드 가이드 v3와 S26 리포트, 스펙·광고 표기 체크리스트를 카피 Agent에 연결하고 가격은 엠바고라 넣지 않겠습니다.', kind: 'message', refs: [...decisions, ...sources, 'req-draft'] },
    { id: 'line-tools', surface: 'slack', place: launch, actorId: 'copy', at: '10/2 09:03', text: 'S26 리포트 조회와 브랜드·법무 표기 검사를 기록했습니다. 자동 검사만으로 확정하지 않고 초안을 팀 검토에 올릴게요.', kind: 'message', refs: ['tool-s26', 'tool-check'] },
    { id: 'line-v1', surface: 'slack', place: launch, actorId: 'ensemble', at: '10/2 09:05', text: '나이트 포트레이트·2030 채널·표기 제약 결정과 S26 리포트를 연결한 v1.0입니다. 메타 피드 3종과 15초 숏폼 초안이며, 섹션마다 근거를 열어볼 수 있습니다.', kind: 'artifact', refs: ['art-v1', ...decisions, 'src-s26'] },
    { id: 'line-legal', surface: 'slack', place: review, actorId: 'minjae', at: '10/3 10:00', text: 'B안 ‘하루 종일 가는 배터리’는 측정 조건 각주가 있어야 하고, ‘압도적’은 최상급이라 빼 주세요.', kind: 'message', refs: ['fb-legal', 'art-v1'] },
    { id: 'line-revise', surface: 'slack', place: review, actorId: 'seoa', at: '10/3 10:02', text: '@Ensemble 위 법무 의견 반영하고 톤 조금 더 따뜻하게. 숏폼은 첫 3초에 인물 클로즈업으로.', kind: 'message', refs: ['fb-brand', 'req-revise', 'fb-legal'] },
    { id: 'line-inherit', surface: 'slack', place: review, actorId: 'ensemble', at: '10/3 10:03', text: '최신 v1.0과 킥오프의 나이트 포트레이트·2030 채널·표기 제약 결정 3건을 찾았습니다. 가이드 v3·스펙·광고 표기 체크리스트를 유지하고, 법무 각주·최상급 의견과 브랜드 톤·오프닝 의견을 반영하겠습니다.', kind: 'message', refs: ['art-v1', ...decisions, 'src-guide', 'src-spec', 'src-legal', 'fb-legal', 'fb-brand'] },
    { id: 'line-v11', surface: 'slack', place: review, actorId: 'ensemble', at: '10/3 10:05', text: 'v1.0을 이어받은 v1.1입니다. 킥오프 결정 3건은 유지하고 법무·브랜드 피드백에 따라 각주 추가, 최상급 제거, 따뜻한 톤과 인물 클로즈업을 반영했습니다.', kind: 'artifact', refs: ['art-v11', 'art-v1', ...decisions, 'fb-legal', 'fb-brand'] },
    { id: 'line-notify', surface: 'slack', place: launch, actorId: 'ensemble', at: '10/3 10:06', text: '@박준호 요청하신 소재가 v1.0에서 v1.1로 갱신됐습니다. 킥오프 결정 3건을 유지하면서 법무·브랜드 피드백을 반영했고, 원래 요청에 수정본을 연결했습니다.', kind: 'artifact', refs: ['req-draft', 'art-v1', 'art-v11', ...decisions, 'fb-legal', 'fb-brand'] },
  ],
  beats: [
    { id: 'beat-01', stage: 1, title: '공유 자료로 시작', caption: '미팅에 앙상블이 함께합니다. 팀이 미리 모은 자료에서 논의를 시작합니다.', focus: 'meeting', lines: ['line-open'], nodes: sources, capabilities: ['cap-meeting', 'cap-permission'] },
    { id: 'beat-02', stage: 1, title: '메시지와 타깃 결정', caption: '메시지와 채널을 사람이 결정합니다. 자료가 결정의 근거로 연결됩니다.', focus: 'meeting', lines: ['line-target'], nodes: ['d-message', 'd-target'], highlight: 'd-message', capabilities: ['cap-meeting', 'cap-decision'] },
    { id: 'beat-03', stage: 1, title: '제약까지 기록', caption: '결정은 회의 안에만 남지 않습니다. 다음 요청에서 다시 쓸 수 있도록 근거와 함께 보존합니다.', focus: 'meeting', lines: ['line-constraint', 'line-capture'], nodes: ['d-constraint'], highlight: 'd-constraint', capabilities: ['cap-meeting', 'cap-decision', 'cap-ledger'] },
    { id: 'beat-04', stage: 2, title: '짧은 요청', caption: '다음 날 준호는 배경을 다시 설명하지 않습니다. 평소 쓰던 채널에서 작업만 요청합니다.', focus: 'slack', lines: ['line-request'], nodes: ['req-draft'], capabilities: ['cap-slack'] },
    { id: 'beat-05', stage: 2, title: '맥락을 이어받기', caption: '앙상블이 어떤 결정과 자료를 이어받았는지 먼저 밝힙니다. 이 외부 채널 연결은 시뮬레이션입니다.', focus: 'slack', lines: ['line-pickup'], nodes: [], capabilities: ['cap-crosschannel', 'cap-channel'] },
    { id: 'beat-06', stage: 3, title: '공유 도구 실행', caption: '실행 에이전트가 사용한 자료와 검사 기록도 연결됩니다. 검사 누락은 이후 사람의 검토로 보완합니다.', focus: 'slack', lines: ['line-tools'], nodes: ['tool-s26', 'tool-check'], highlight: 'tool-check', capabilities: ['cap-tools', 'cap-ledger'] },
    { id: 'beat-07', stage: 3, title: '첫 드래프트', caption: '메타 피드와 숏폼이 하나의 결과물로 도착합니다. 아직 검토 전 초안입니다.', focus: 'slack', lines: ['line-v1'], nodes: ['art-v1'], highlight: 'art-v1', capabilities: ['cap-artifact'] },
    { id: 'beat-08', stage: 4, title: '왜 이 문장인가', caption: '허브에서 결과물의 섹션을 열어 보세요. 요청과 도구, 결정과 공유 자료까지 근거를 따라갈 수 있습니다.', focus: 'hub', lines: [], nodes: [], highlight: 'art-v1', capabilities: ['cap-provenance', 'cap-ledger'] },
    { id: 'beat-09', stage: 5, title: '다른 채널의 검토', caption: '브랜드 검토 채널에서 법무가 초안을 확인합니다. 피드백 역시 결과물에 연결되는 업무 맥락입니다.', focus: 'slack', lines: ['line-legal'], nodes: ['fb-legal'], highlight: 'fb-legal', capabilities: ['cap-slack', 'cap-artifact'] },
    { id: 'beat-10', stage: 5, title: '다른 사람이 이어서 요청', caption: '서아는 이전 파일의 위치나 킥오프 배경을 설명하지 않습니다. 앙상블이 최신 버전과 결정을 이어받습니다.', focus: 'slack', lines: ['line-revise', 'line-inherit'], nodes: ['fb-brand', 'req-revise'], capabilities: ['cap-crosschannel'] },
    { id: 'beat-11', stage: 5, title: 'v1.1과 원래 요청자 알림', caption: '수정본을 검토 채널에 게시하고 준호의 원래 요청에도 알립니다. 채널이 달라도 같은 결과물 이력을 공유합니다.', focus: 'slack', lines: ['line-v11', 'line-notify'], nodes: ['art-v11'], highlight: 'art-v11', capabilities: ['cap-crosschannel', 'cap-artifact'] },
    { id: 'beat-12', stage: 5, title: '다음 작업의 자산', caption: 'v1.1에는 이전 버전, 두 피드백, 세 결정이 함께 남습니다. 재설명·탐색·재작업·추적 지표는 아직 측정 결과가 아닌 시나리오 가정입니다.', focus: 'hub', lines: [], nodes: [], highlight: 'art-v11', capabilities: ['cap-provenance', 'cap-ledger', 'cap-permission'] },
  ],
  capabilities: [
    { id: 'cap-meeting', label: '녹스 미팅에 에이전트 초대·결정 캡처', availability: 'planned', note: '실제 미팅 연결은 추가 개발이 필요하며 이 화면은 로컬 시뮬레이션입니다.' },
    { id: 'cap-slack', label: '슬랙 채널에서 @Ensemble 호출', availability: 'planned', note: '실제 슬랙 호출은 추가 개발이 필요하며 데모 대화는 미리 작성되어 있습니다.' },
    { id: 'cap-channel', label: '앙상블 자체 채널에서 사람·PM·에이전트 대화', availability: 'implemented', note: '자체 앱의 메시지·작성 UI는 구현되어 있으며 외부 채널 연동과는 구분됩니다.', evidence: ['app/apps/web/components/Message.tsx', 'app/apps/web/components/Composer.tsx'] },
    { id: 'cap-decision', label: '결정 요청·기록', availability: 'implemented', note: '자체 앱에서 결정 요청 카드와 사용자 결정 처리를 제공합니다.', evidence: ['app/apps/web/components/DecisionRequestCard.tsx'] },
    { id: 'cap-ledger', label: '이벤트 ledger로 대화·결정·작업 기록 보존', availability: 'implemented', note: '이벤트 저장소는 구현되어 있으며 이 데모는 서버에 기록하지 않습니다.', evidence: ['app/packages/store/src/sqlite.ts'] },
    { id: 'cap-artifact', label: '결과물 첨부·revision·검토', availability: 'implemented', note: '자체 앱의 결과물 첨부와 수정·검토 처리는 구현되어 있으며 데모 소재는 가상입니다.', evidence: ['app/apps/web/components/Message.tsx', 'app/apps/web/components/TaskResolution.tsx', 'app/packages/orchestrator/src/dispatch.ts'] },
    { id: 'cap-provenance', label: '섹션 단위 근거 추적 그래프', availability: 'demoable', note: '이 시연의 고정된 노드·관계로 근거 추적을 보여주며 실제 데이터 자동 추출은 연결하지 않았습니다.' },
    { id: 'cap-crosschannel', label: '다른 채널·다른 사람 요청에서 최신 버전·결정 자동 선택', availability: 'demoable', note: '고정 시나리오가 최신 버전과 결정을 선택하며 실제 외부 채널 맥락 통합은 아닙니다.' },
    { id: 'cap-tools', label: '팀 공유 도구 실행 기록', availability: 'demoable', note: '도구 실행 기록은 로컬 데이터이며 실제 도구를 호출하지 않습니다.' },
    { id: 'cap-permission', label: '팀·사용자 권한별 맥락·도구 제공', availability: 'planned', note: '팀과 사용자 권한에 따른 맥락·도구 제공은 추가 개발이 필요합니다.' },
  ],
  metrics: [
    { id: 'm-reexplain', label: '배경 재설명 횟수', legacy: '채널·담당자 바뀔 때마다', ensemble: '0회', verification: '인수인계 실험에서 재설명 발화 수 비교' },
    { id: 'm-search', label: '자료 탐색·전달', legacy: '링크·파일을 찾아 붙여넣기', ensemble: '에이전트가 근거를 인용', verification: '자료 탐색·전달 시간 측정' },
    { id: 'm-rework', label: '인수인계 후 재작업', legacy: '옛 버전·결정 누락으로 재작업', ensemble: '최신 버전·결정 자동 연결', verification: '후속 수정에서 잘못된 버전 사용 비율' },
    { id: 'm-trace', label: '결정 근거 추적', legacy: '회의록·스레드 수동 검색', ensemble: '섹션→결정→자료 클릭 추적', verification: '근거 질문에 답하는 시간·정확도' },
  ],
};
