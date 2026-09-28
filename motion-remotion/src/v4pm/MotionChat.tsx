import React from 'react';
import {px, colors as c} from '../v3/tokens/video';
import {HeroLift} from '../v4/ui/HeroLift';
import {DebugDot3D} from '../v4/callouts/CalloutV4';
import {Avatar, Text, Chip, CardBody, Field, Note} from './Board';
import {MESSAGES, VIEW, scrollAt, heroAt, ramp, type Message} from './motion';

const Body: React.FC<{message: Message}> = ({message: m}) => {
  if (m.kind === 'text') return <div style={{boxSizing: 'border-box', width: px(VIEW.w), height: px(m.h - 42), borderRadius: px(20), padding: `${px(12)}px ${px(20)}px`, background: m.speaker === 'AI PM' ? c.primaryContainer : m.speaker.includes('Agent') ? c.voice3Container : c.surface, border: `${px(1)}px solid ${c.outlineVariant}`}}>
    {m.body?.map(line => <Text key={line} size={20}>{line}</Text>)}
    {m.badge && <div style={{marginTop: px(6)}}><Chip tone={m.id.includes('missing') ? 'amber' : m.id === 'update-ack' ? 'amber' : 'green'}>{m.badge}</Chip></div>}
  </div>;
  return <div style={{position: 'relative', width: px(VIEW.w), height: px(m.h - 42), background: c.surface, border: `${px(1)}px solid ${c.outlineVariant}`, borderRadius: px(28), boxSizing: 'border-box'}}>
    <div style={{position: 'absolute', left: 0, top: px(26), bottom: px(26), width: px(3), background: c.primary}}/>
    <div style={{position: 'absolute', left: px(28), top: px(24), width: px(644), height: px(40), display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: px(12)}}><Text size={22} weight={700} color={c.brandInk}>{m.title}</Text><Chip hero>{m.badge}</Chip></div>
    {(m.kind === 'team' || m.kind === 'plan') && <CardBody beat={m.kind === 'team' ? 'B1' : 'B2'}/>}
    {m.kind === 'handoff' && <>
      <Field y={94} label="목표" value="고객 문제 ①을 푸는 흐름 초안"/>
      <Field y={145} label="결정 이유" value="인터뷰에서 반복된 문제 ①" detail="D1 · 김도윤 · 원문 보기"/>
      <Field y={218} label="입력" value="조사 요약 · 인터뷰 기록" detail="이서연에게 전달 · 남은 질문은 대화로"/>
    </>}
    {m.kind === 'impact' && <>
      <div style={{position: 'absolute', left: px(28), top: px(88)}}><Text size={20}>상세를 기다리면 2일 늦어요.</Text><Text size={20}>지금 초안으로 계속하면 기한 안이에요.</Text></div>
      <div style={{position: 'absolute', left: px(28), top: px(158), display: 'flex', gap: px(12)}}><Chip tone="amber">상세 후 · 기한 +2일</Chip><Chip>초안 계속 · 재작업 가능</Chip></div>
    </>}
    {m.kind === 'change' && <>
      <Field y={94} label="결제 흐름" value="포함 → 이번 범위 제외"/>
      <Field y={145} label="상세 설계" value="이번 주 → 다음 주 · 이서연 확인"/>
      <Field y={196} label="제작 입력" value="보완 r2 유지 · 제작 계속"/>
      <Note y={247}><Text small>범위 · 김도윤 / 시간 · 이서연 / 계획 반영 · PM(위임 내)</Text><Text small color={c.secondary}>옛 결제 결과는 보존하고 인계에서 제외해요.</Text></Note>
    </>}
    {m.kind === 'result' && <div style={{position: 'absolute', left: px(28), top: px(87)}}><Text size={20}>온보딩 · 고객 문제 ① 흐름 유지</Text><Text size={20} weight={600} color={c.primary}>결제 흐름 제외 · 계획 v2 기준</Text></div>}
  </div>;
};

const sender = (m: Message) => ({
  agent: m.speaker !== '김도윤' && m.speaker !== '이서연',
  color: m.speaker === 'AI PM' ? c.primaryContainer : m.speaker === '김도윤' ? c.humanDecisionMaker : m.speaker === '이서연' ? c.humanDesigner : m.speaker === '변경 전달' ? c.secondaryContainer : c.voice3Container,
  short: m.speaker === 'AI PM' ? 'PM' : m.speaker === '김도윤' ? '도' : m.speaker === '이서연' ? '서' : m.speaker === '변경 전달' ? '↗' : '제',
});

export const MotionChat: React.FC<{frame: number; debug?: boolean}> = ({frame, debug}) => {
  const scroll = scrollAt(frame), hero = heroAt(frame);
  return <>
    <div data-chat-viewport data-scroll={scroll} style={{position: 'absolute', left: px(VIEW.x), top: px(VIEW.y), width: px(VIEW.w), height: px(VIEW.h), overflow: 'hidden'}}>
      {MESSAGES.filter(m => m.from <= frame && m.y + m.h - scroll > -20 && m.y - scroll < VIEW.h + 80).map(m => {
        const s = sender(m), enter = ramp(frame, m.from, 10);
        return <div key={m.id} data-chat-event={m.id} data-event-from={m.from} style={{position: 'absolute', left: 0, top: px(m.y - scroll), width: px(VIEW.w), height: px(m.h), opacity: enter, transform: `translateY(${px((1 - enter) * 10)}px)`}}>
          <div style={{height: px(36), display: 'flex', alignItems: 'center', gap: px(12)}}><Avatar name={s.short} agent={s.agent} color={s.color}/><Text small weight={600} color={c.secondary}>{m.speaker}</Text></div>
          {hero?.message.id !== m.id && <div style={{position: 'absolute', top: px(42)}}><Body message={m}/></div>}
        </div>;
      })}
    </div>
    {hero && <HeroLift card={hero.card} rise={hero.rise}>
      <div data-chat-event={hero.message.id} data-hero-event style={{position: 'absolute', inset: 0}}><Body message={hero.message}/></div>
      {debug && <DebugDot3D x={hero.card.w - 32} y={44}/>}
    </HeroLift>}
  </>;
};
