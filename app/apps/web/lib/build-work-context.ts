// 기반 접합부: WORK CONTEXT 화면 모델을 캔버스(B)와 카드·미리보기(C) builder로 조립한다. 두 작업 흐름은 이 파일을 고치지 않는다.
import type { ProjectState } from '@ensemble/core';
import type { VmMessage } from './view-model';
import type { VmWorkContext } from './work-context-view-model';
import { buildContextCanvas, type NameOf } from './build-context-canvas';
import { buildContextCards } from './build-context-cards';

/** Work Context가 없는 프로젝트면 undefined: 기존 화면이 그대로 그려진다. */
export function buildWorkContext(state: ProjectState, name: NameOf, me: string, messages: VmMessage[]): { view: VmWorkContext; messages: VmMessage[] } | undefined {
  const wc = state.workContext;
  if (!wc) return undefined;
  const canvas = buildContextCanvas(state, name), cards = buildContextCards(state, name, me);
  const { cardFor, ...rest } = cards;
  return {
    view: { code: wc.session.code, title: wc.session.title, channelName: wc.session.channelName, ...canvas, ...rest },
    messages: messages.map(m => { const card = cardFor(m.id); return card ? { ...m, contextCard: card } : m; }),
  };
}
