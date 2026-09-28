import React, {useEffect, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender} from 'remotion';
import {ensurePretendardLoaded} from '../tokens/fonts';
import {colors, spacing, type, textStyle} from './tokens';

import {AppRail} from './components/AppRail';
import {ChannelMemberList} from './components/ChannelMemberList';
import {ThreadPanel} from './components/ThreadPanel';
import {Composer} from './components/Composer';
import {PmPlanCard} from './components/PmPlanCard';
import {AssignmentProposalCard} from './components/AssignmentProposalCard';
import {HandoffCard} from './components/HandoffCard';
import {WaitingAgentStartRow} from './components/WaitingAgentStartRow';
import {HumanMessageRow} from './primitives/MessageRow';

const MAIN_X = spacing.railWidth + spacing.sidebarWidth; // 352
const SCREEN_W = 1440;
const SCREEN_H = 900;
const THREAD_X = SCREEN_W - spacing.threadWidth - spacing[2]; // 1032
const TIMELINE_W = 660;

export const UiMockupFlat: React.FC = () => {
  const [handle] = useState(() => delayRender('loading Pretendard (UiMockupFlat)'));
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    ensurePretendardLoaded()
      .then(() => {
        setFontReady(true);
        continueRender(handle);
      })
      .catch((err) => {
        console.error(err);
        continueRender(handle);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!fontReady) {
    return <AbsoluteFill style={{backgroundColor: colors.background}} />;
  }

  return (
    <AbsoluteFill style={{backgroundColor: colors.background, fontFamily: 'Pretendard, system-ui, sans-serif'}}>
      {/* App rail */}
      <div style={{position: 'absolute', left: 0, top: 0, width: spacing.railWidth, height: SCREEN_H}}>
        <AppRail />
      </div>

      {/* Sidebar */}
      <div style={{position: 'absolute', left: spacing.railWidth, top: 0, width: spacing.sidebarWidth, height: SCREEN_H}}>
        <ChannelMemberList
          projectName="고객 검증 MVP"
          channels={[
            {id: 'c1', name: 'customer-validation-mvp', active: true, unread: 0},
            {id: 'c2', name: 'general'},
            {id: 'c3', name: '디자인'},
          ]}
          dms={[{id: 'd1', name: '김도윤', unread: 2}]}
          agents={[
            {name: '리서치 Agent', voiceKey: 'voice1', statusLabel: '대기'},
            {name: '프로토타입 Agent', voiceKey: 'voice2', statusLabel: '작업 중'},
          ]}
        />
      </div>

      {/* Main column header */}
      <div
        style={{
          position: 'absolute',
          left: MAIN_X,
          top: 0,
          width: SCREEN_W - MAIN_X,
          height: 48,
          borderBottom: `1px solid ${colors.outlineVariant}`,
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${spacing[6]}px`,
          boxSizing: 'border-box',
        }}
      >
        <span style={textStyle(type.titleMd, colors.onSurface)}># customer-validation-mvp</span>
      </div>

      {/* Timeline */}
      <div
        style={{
          position: 'absolute',
          left: MAIN_X + spacing[6],
          top: 48 + spacing[2],
          width: TIMELINE_W,
          height: SCREEN_H - 48 - spacing[2] - 56 - spacing[2],
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: spacing[2],
        }}
      >
        <div style={{flexShrink: 0}}>
          <HumanMessageRow name="류시헌" initials="류" timestamp="어제 14:02" text="2주 안에 이 아이디어의 고객 반응을 확인하자. 나와 디자이너 한 명이 참여할 거야." />
        </div>

        <div style={{flexShrink: 0}}>
          <PmPlanCard
            title="계획: 고객 문제 검증"
            conclusion="경쟁사 조사 Agent와 프로토타입 제작 Agent를 투입할게요."
            bullets={[
              {who: '리서치 Agent', what: '경쟁사 조사 시작'},
              {who: '김도윤', what: '고객 인터뷰 5건 및 사용 흐름 설계'},
              {who: '프로토타입 Agent', what: '흐름 확정 후 착수'},
            ]}
            needsYouLabel="결정 필요: 검증할 고객 문제 확정"
            primaryLabel="계획 승인"
            secondaryLabel="수정 요청"
          />
        </div>

        <div style={{flexShrink: 0}}>
          <AssignmentProposalCard
            fromAvatar="pm"
            toAgent={{name: '리서치 Agent', role: '경쟁사 조사 담당', voiceKey: 'voice1'}}
            title="경쟁사 조사"
            criteria={['경쟁 제품 3개 이상 비교', '가격/포지셔닝 요약']}
            dueLabel="금요일 18:00"
            budgetLabel="자동 턴 3/8"
            status="working"
          />
        </div>

        <div style={{flexShrink: 0}}>
          <HandoffCard
            fromAgent={{name: '리서치 Agent', voiceKey: 'voice1'}}
            toAgent={{name: '김도윤', kind: 'human'}}
            fields={{
              purpose: '검증할 고객 문제 하나를 확정하기 위한 사용 흐름 설계',
              background: '경쟁사 3곳 비교 완료, 가격/포지셔닝 격차 확인됨',
              decisionReason: '후보 ① 채택 — 인터뷰 기록 근거',
              progress: '인터뷰 5건 수집 완료 · 사용 흐름 설계 착수 전',
              result: '경쟁사_비교_v1.pdf',
            }}
            understoodLine="김도윤가 이해한 내용: 결정 ①의 문제를 다루는 흐름을 설계하면 됩니다."
          />
        </div>

        <div style={{flexShrink: 0}}>
          <WaitingAgentStartRow
            agent={{name: '프로토타입 Agent', voiceKey: 'voice2'}}
            status="working"
            caption="김도윤의 결과가 올라오자 자동으로 시작됨"
          />
        </div>
      </div>

      {/* Composer */}
      <div
        style={{
          position: 'absolute',
          left: MAIN_X + spacing[6],
          top: SCREEN_H - 56 - spacing[2],
          width: TIMELINE_W,
          height: 56,
        }}
      >
        <Composer mentionLabel="@프로토타입 Agent" restText="" />
      </div>

      {/* Thread panel (floating) */}
      <div style={{position: 'absolute', left: THREAD_X, top: spacing[2], width: spacing.threadWidth}}>
        <ThreadPanel
          goal={{
            goalText: '정확한 고객 문제 하나를 확정하고, 검증 근거를 확보한다',
            criteria: [
              {id: 'C1.1', label: '인터뷰 기록 5건', badgeState: 'self-report', badgeLabel: 'self-report'},
              {id: 'C2.1', label: '경쟁사 비교 보고서', badgeState: 'passed', badgeLabel: 'passed · human 승인'},
            ],
            footerNote: '4개 태스크 완료돼도 목표 미달성 가능 · 결정권자 승인 필요',
          }}
          steps={[
            {label: '배정', done: true},
            {label: 'Handoff', done: true},
            {label: '결과', done: false},
          ]}
        />
      </div>
    </AbsoluteFill>
  );
};
