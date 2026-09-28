import React from 'react';
import {px, colors as c, FONT_FAMILY, clayInsetShadow, embossChipShadow} from '../v3/tokens/video';
import {HeroLift} from '../v4/ui/HeroLift';
import {DebugDot3D} from '../v4/callouts/CalloutV4';
import {ANCHOR, CARD, titles, badges, captions, type Beat} from './content';

const box = (x: number, y: number, w?: number, h?: number): React.CSSProperties => ({position: 'absolute', left: px(x), top: px(y), width: w === undefined ? undefined : px(w), height: h === undefined ? undefined : px(h)});
export const Text: React.FC<{children: React.ReactNode; small?: boolean; color?: string; weight?: number; size?: number; style?: React.CSSProperties}> = ({children, small, color = c.onSurface, weight = 400, size, style}) => <div data-pm-text={small ? 'secondary' : 'body'} style={{fontSize: px(size ?? (small ? 16 : 18)), lineHeight: 1.4, color, fontWeight: weight, ...style}}>{children}</div>;
export const Chip: React.FC<{children: React.ReactNode; hero?: boolean; tone?: 'green' | 'blue' | 'amber' | 'neutral'}> = ({children, hero, tone = 'green'}) => {
  const tones = {green: [c.primaryContainer, c.onPrimaryContainer], blue: [c.infoContainer, c.voice2On], amber: [c.warningContainer, c.warning], neutral: [c.surfaceContainer, c.onSurfaceVariant]};
  return <div data-pm-chip={hero ? 'hero' : 'support'} style={{height: px(hero ? 36 : 29), padding: `0 ${px(14)}px`, display: 'inline-flex', alignItems: 'center', borderRadius: px(99), whiteSpace: 'nowrap', background: tones[tone][0], boxShadow: embossChipShadow}}><Text small weight={600} color={tones[tone][1]}>{children}</Text></div>;
};
export const Avatar: React.FC<{name: string; agent?: boolean; color: string}> = ({name, agent, color}) => <div style={{width: px(36), height: px(36), borderRadius: px(agent ? 10 : 99), background: color, boxShadow: clayInsetShadow, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}><Text weight={700} color={c.onSurface}>{name}</Text></div>;
export const Row: React.FC<{y: number; title: string; detail?: string; chip?: string; tone?: 'green' | 'blue' | 'amber' | 'neutral'; avatar?: string; agent?: boolean; color?: string}> = ({y, title, detail, chip, tone, avatar, agent, color = c.humanDesigner}) => <div data-pm-block style={{...box(28, y, 644, 52), display: 'flex', alignItems: 'center', gap: px(14)}}>
  {avatar && <Avatar name={avatar} agent={agent} color={color}/>}
  <div style={{flex: 1}}><Text weight={600}>{title}</Text>{detail && <Text small color={c.onSurfaceVariant}>{detail}</Text>}</div>
  {chip && <Chip tone={tone}>{chip}</Chip>}
</div>;
export const Note: React.FC<{y: number; children: React.ReactNode; tone?: string}> = ({y, children, tone = c.surfaceContainerLow}) => <div data-pm-block style={{...box(28, y, 644), boxSizing: 'border-box', padding: `${px(12)}px ${px(16)}px`, borderRadius: px(12), background: tone}}>{children}</div>;
export const Field: React.FC<{y: number; label: string; value: string; detail?: string}> = ({y, label, value, detail}) => <div data-pm-block style={box(28, y, 644)}><div style={box(0, 0, 96)}><Text small color={c.secondary} weight={600}>{label}</Text></div><div style={{marginLeft: px(108)}}><Text>{value}</Text>{detail && <Text small color={c.onSurfaceVariant}>{detail}</Text>}</div></div>;

export const CardBody: React.FC<{beat: Beat}> = ({beat}) => {
  if (beat === 'B1') return <>
    <Row y={94} avatar="PM" agent color={c.primaryContainer} title="AI PM" detail="인계 판단 · 조율 · 계획 반영" chip="대화 확인 중"/>
    <Row y={153} avatar="도" color={c.humanDecisionMaker} title="김도윤" detail="사람 · 목표와 범위 결정" chip="결정권자" tone="neutral"/>
    <Row y={212} avatar="서" title="이서연" detail="사람 · 사용 흐름 설계" chip="디자이너" tone="neutral"/>
    <Row y={271} avatar="조" agent color={c.infoContainer} title="조사 Agent" detail="자료 조사 · 근거와 한계 공유" chip="실행 Agent" tone="blue"/>
    <Row y={330} avatar="제" agent color={c.voice3Container} title="프로토타입 Agent" detail="초안을 받아 제작 · 변경 확인" chip="실행 Agent" tone="blue"/>
  </>;
  if (beat === 'B2') return <>
    <Note y={87}><Text small weight={600}>가용 시간 · 김도윤 주 6시간 / 이서연 주 8시간</Text></Note>
    <Row y={143} avatar="조" agent color={c.infoContainer} title="자료 조사" detail="조사 Agent · 역할 일치" chip="함께 시작" tone="blue"/>
    <Row y={199} avatar="도" color={c.humanDecisionMaker} title="고객 인터뷰" detail="김도윤 · 가용 시간 확인" chip="함께 시작" tone="blue"/>
    <Row y={255} avatar="서" title="흐름 초안" detail="이서연 · 고객 문제 선택 후" chip="입력 대기" tone="neutral"/>
    <Row y={311} avatar="제" agent color={c.voice3Container} title="프로토타입" detail="프로토타입 Agent · 초안 확인 후" chip="입력 대기" tone="neutral"/>
    <div style={box(28, 382)}><Text small color={c.primary} weight={600}>목표·시간·위임 범위 · 당사자 확인</Text></div>
  </>;
  if (beat === 'B3') return <>
    <Field y={96} label="목표" value="선택한 고객 문제를 푸는 흐름 초안"/>
    <Field y={151} label="결정 이유" value="인터뷰에서 반복된 문제 ①" detail="결정 D1 · 김도윤 · 원문 보기"/>
    <Field y={220} label="입력" value="조사 요약 · 인터뷰 기록 · 흐름 초안 r1"/>
    <Field y={271} label="초안의 한계" value="진입 화면 보완 필요 · 상세 설계는 진행 중"/>
    <Note y={327} tone={c.secondaryContainer}><Text small weight={600}>Agent → 사람 · 필요한 판단</Text><Text>“결제 흐름도 만들까요?” · 김도윤 답변 대기</Text></Note>
  </>;
  if (beat === 'B4') return <>
    <Note y={87} tone={c.warningContainer}><Text small weight={600} color={c.warning}>보완 이력 · 진입 화면 누락 → 이서연이 추가</Text></Note>
    <Row y={148} avatar="서" title="이서연 · 흐름 초안 r2 첨부" detail="진입 화면을 보완했어요. 상세 설계는 이어서 할게요."/>
    <Row y={220} avatar="PM" agent color={c.primaryContainer} title="PM · 인계 조건 확인" detail="문제 ①과 진입 흐름이 있어 제작할 수 있어요." chip="인계 가능"/>
    <Row y={292} avatar="제" agent color={c.voice3Container} title="프로토타입 Agent · 제작 중" detail="입력: 흐름 초안 r2 · 계획 v1" chip="자동 시작" tone="blue"/>
    <div style={box(28, 377)}><Text small color={c.secondary} weight={600}>동시에 · 이서연은 상세 설계 진행 중</Text></div>
  </>;
  if (beat === 'B5') return <>
    <div data-pm-block style={box(28, 91, 644)}><Text small color={c.secondary} weight={600}>이서연</Text><Text>목요일 휴가예요. 상세는 다음 주에 드릴게요.</Text></div>
    <Note y={151} tone={c.primaryContainer}><Text small weight={600} color={c.primary}>AI PM · 기한 영향</Text><Text>상세를 기다리면 2일 늦어요.</Text><Text>지금 초안으로 계속하면 기한 안이에요.</Text></Note>
    <div data-pm-block style={{...box(28, 264, 644), display: 'flex', gap: px(12)}}>
      <div style={{flex: 1, padding: px(12), borderRadius: px(12), background: c.surfaceContainerLow}}><Text small>상세 후 제작</Text><Text weight={600} color={c.warning}>기한 +2일</Text></div>
      <div style={{flex: 1, padding: px(12), borderRadius: px(12), background: c.secondaryContainer}}><Text small>초안으로 계속</Text><Text weight={600} color={c.primary}>기한 안 · 재작업 가능</Text></div>
    </div>
    <div data-pm-block style={box(28, 354, 644)}><Text small>이서연 · 초안으로 계속해요. 상세는 다음 주에 할게요.</Text><Text small weight={600}>김도윤 · 결제 흐름은 이번 범위에서 빼죠.</Text></div>
  </>;
  return <>
    <div data-pm-block style={{...box(28, 91, 644), display: 'grid', gridTemplateColumns: `${px(102)}px 1fr 1fr`, gap: px(10)}}>
      <Text small color={c.secondary}>바뀐 항목</Text><Text small color={c.secondary}>v1</Text><Text small weight={600} color={c.primary}>v2 · PM 반영</Text>
      <Text>결제 흐름</Text><Text color={c.onSurfaceVariant}>제작 범위에 포함</Text><Text weight={600}>이번 범위 제외</Text>
      <Text>상세 설계</Text><Text color={c.onSurfaceVariant}>이번 주</Text><Text weight={600}>다음 주 · 본인 확인</Text>
      <Text>제작 입력</Text><Text color={c.onSurfaceVariant}>보완 초안 r2</Text><Text weight={600}>r2 유지 · 제작 계속</Text>
    </div>
    <Note y={239}><Text small>범위 · 김도윤 / 시간 · 이서연 / 계획 반영 · PM(위임 내)</Text></Note>
    <Row y={297} title="이서연 · 변경 확인" detail="프로토타입 Agent · 전송됨 → 변경 확인" chip="결과 반영 대기" tone="amber"/>
    <Note y={361} tone={c.secondaryContainer}><Text small>이전 계획의 결제 결과 · 보존 / 인계 제외</Text></Note>
  </>;
};

export const Board: React.FC<{beat: Beat; rise: number; debug?: boolean; overview?: boolean; landed?: boolean; timeline?: React.ReactNode; activePM?: boolean; roadmap?: {version: string; title: string; detail: string; status: string}}> = ({beat, rise, debug, overview, landed, timeline, activePM, roadmap}) => <div style={{position: 'absolute', width: px(1440), height: px(900), fontFamily: FONT_FAMILY, transformStyle: 'preserve-3d'}}>
  <div data-pm-board style={{position: 'absolute', inset: 0, background: c.background, borderRadius: px(20), border: `${px(1)}px solid ${c.outlineVariant}`, boxSizing: 'border-box'}}/>
  <div style={{...box(0, 0, 72, 900), background: c.surfaceContainerLow, borderRadius: `${px(20)}px 0 0 ${px(20)}px`}}/>
  <div style={{...box(80, 0, 210, 900), background: c.surfaceContainerLow}}/>
  <div style={box(22, 24)}><Avatar name="e" agent color={c.primaryContainer}/></div>
  <div style={box(96, 26)}><Text size={22} weight={700} color={c.brandInk}>ensemble</Text></div>
  <div style={box(96, 92)}><Text small color={c.secondary}>프로젝트</Text><Text weight={600}>고객 반응 확인</Text></div>
  <div style={{...box(90, 170, 190, 46), background: c.secondaryContainer, borderRadius: px(12), display: 'flex', alignItems: 'center', paddingLeft: px(10), boxSizing: 'border-box'}}><Text small weight={600}># 고객반응-검증</Text></div>
  <div style={box(96, 264)}><Text small color={c.secondary} weight={600}>팀원 5</Text></div>
  {['AI PM', '김도윤', '이서연', '조사 Agent', '프로토타입 Agent'].map((name, i) => <div key={name} style={{...box(96, 306 + i * 48), display: 'flex', alignItems: 'center', gap: px(9)}}><div style={{width: px(10), height: px(10), borderRadius: i === 1 || i === 2 ? '50%' : px(3), background: i === 0 ? c.primary : i === 3 ? c.agentResearch : i === 4 ? c.agentPrototype : c.humanDesigner}}/><Text small weight={i === 0 ? 600 : 400}>{name}</Text>{(activePM ?? landed) && i === 0 && <Chip>지휘 중</Chip>}</div>)}
  <div style={box(96, 578)}><Text small color={c.secondary}>사람 2 · Agent 2</Text></div>
  <div style={{...box(312, 0, 1100, 72), borderBottom: `${px(1)}px solid ${c.outlineVariant}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}><Text size={24} weight={600}># 고객반응-검증</Text><Text small color={c.secondary}>팀원 5 · 시연 예시</Text></div>
  {timeline === undefined && <div data-pm-block style={box(330, 97, 1040)}><Text>{landed ? '김도윤 · 2주 안에 이 아이디어의 고객 반응을 확인하자.' : captions[beat]}</Text></div>}
  <div data-motion-roadmap style={{...box(1110, 376, 282), ...(timeline === undefined ? {} : {transform: 'translateZ(2px)', background: c.background, isolation: 'isolate' as const})}}><Text small color={c.secondary} weight={600}>고정 로드맵 · {roadmap?.version ?? (beat === 'B6' ? 'v2' : 'v1')}</Text><div style={{marginTop: px(16)}}><Text weight={600}>{roadmap?.title ?? (beat === 'B6' ? '상세 설계 + 제작' : beat === 'B4' || beat === 'B5' ? '초안 이후, 병행' : '목표까지 이어지는 일')}</Text></div><div style={{marginTop: px(12)}}><Text small color={c.secondary}>{roadmap?.detail ?? (beat === 'B6' ? '예상 종료 · 기한 안' : beat === 'B5' ? '상세 대기 시 · 2일 지연' : '예상 종료 · 입력 확인 중')}</Text></div><div style={{marginTop: px(12)}}><Text small>{roadmap?.status ?? (beat === 'B6' ? 'Agent 결과 반영 대기' : beat === 'B3' ? '범위 답변 · 김도윤' : '막힌 곳과 풀 사람을 확인')}</Text></div></div>
  <div style={{...box(330, 628, 1056, 46), border: `${px(1)}px solid ${c.outlineVariant}`, borderRadius: px(20), background: c.surface, display: 'flex', alignItems: 'center', paddingLeft: px(18), boxSizing: 'border-box'}}><Text small color={c.secondary}>메시지 보내기 · @로 팀원 호출</Text></div>
  {timeline === undefined && <HeroLift card={CARD} rise={overview ? 0 : rise}>
    <div style={{position: 'absolute', inset: 0, borderRadius: px(28), background: c.surface, boxShadow: `inset 0 ${px(1)}px 0 rgba(255,255,255,.9)`, border: `${px(1)}px solid ${c.outlineVariant}`, boxSizing: 'border-box'}}/>
    <div style={{...box(0, 26, 3, CARD.h - 52), background: c.primary, borderRadius: px(3)}}/>
    <div data-pm-block style={{...box(28, 24, 644, 40), display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: px(12)}}><Text size={22} weight={700} color={c.brandInk}>{landed ? 'AI PM' : titles[beat]}</Text><Chip hero>{landed ? '지휘 중' : badges[beat]}</Chip></div>
    {landed ? <>
      <div data-pm-block style={box(28, 103, 644)}><Text size={24} weight={600}>도윤님·서연님, 이번 주 가용 시간을 알려 주세요.</Text><Text size={24} weight={600}>그 안에서 조사와 인터뷰를 나눌게요.</Text></div>
      <Note y={225} tone={c.primaryContainer}><Text weight={600} color={c.primary}>다음 행동 · 김도윤·이서연의 가용 시간 입력</Text><Text small>사람의 시간은 당사자가 정해요.</Text></Note>
      <Row y={327} title="계획 v1 준비" detail="목표 · 2주 안에 고객 반응 확인" chip="답변 대기" tone="amber"/>
    </> : <CardBody beat={beat}/>}
    {debug && <DebugDot3D x={ANCHOR.x - CARD.x} y={ANCHOR.y - CARD.y}/>}
  </HeroLift>}
  {timeline}
</div>;
