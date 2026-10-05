import assert from 'node:assert/strict';
import test from 'node:test';
import { demoReducer as reduce, initialDemo, type DemoState, type PendingChoice } from '../demo/scripted/coordination/fixed-demo.ts';

// Local scripted presentation only: no live PM reasoning, providers or rendered-output claims.
const send = (state: DemoState, text: string) => reduce(state, { type: 'send', phase: state.phase, text });
const finish = (state: DemoState) => ({ type: 'finish' as const, phase: state.phase, run: state.run });
const proposal = '2안이 좋아요. 표현은 조금 낮춰주세요.';
const preview = '그럼 이 기준으로 화면 한번 볼까요?';
const change = 'fiction 표시를 넣고 노래는 제외해 주세요.';
const choice = (state: DemoState, selected: PendingChoice) => ({ type: 'choose_pending' as const, choice: selected, run: state.run, request: state.pending!.text });
const discussion = () => {
  const comparing = reduce(initialDemo(), { type: 'start' });
  assert.equal(comparing.phase, 'comparing');
  assert.equal(comparing.revision, 0, 'comparison is not permission to deliver a screen');
  return reduce(comparing, finish(comparing));
};

test('scripted comparison precedes human judgment; natural proposals and bounded preview invitations work', () => {
  let state = discussion();
  assert.equal(state.phase, 'discussion');
  const examples = state.messages.filter(m => m.speaker === 'Story');
  assert.ok(examples.length, 'Story must provide evidence before the human judgment gate');
  const evidence = examples.map(m => m.text).join(' ');
  assert.match(evidence, /①|1안|첫 번째|첫번째/);
  assert.match(evidence, /②|2안|두 번째|두번째/);
  assert.match(evidence, /운명적 구원/, 'the expression under review must appear in the actual example');
  for (const opinion of [' ', '아직 정하지 못했어요', '2안이 좋아요. 하지만 아직 진행하지 마세요.', '두 번째가 좋지 않아요. 표현이 과해요']) {
    state = send(state, opinion);
    assert.equal(state.phase, 'discussion', 'missing, uncertain or vetoed input must not authorize work');
    assert.equal(state.revision, 0);
  }
  const count = state.messages.length;
  state = send(state, '아직 정하지 못했어요');
  assert.equal(state.messages.length, count, 'duplicate concern must not append another exchange');
  assert.strictEqual(reduce(state, finish(state)), state, 'a timer cannot answer for the human');
  state = send(state, preview); // Early preview text must not poison the later gate.
  assert.equal(state.phase, 'discussion');
  const concernedProposal = send(state, '두 번째가 재밌는데 이 표현은 과해요');
  assert.equal(concernedProposal.phase, 'agreement', 'a preferred example plus concern enables discussion, never execution');
  assert.equal(concernedProposal.revision, 0);
  state = send(state, proposal);
  assert.equal(state.phase, 'agreement');
  assert.equal(state.revision, 0, 'a preferred variant is not screen authorization');
  assert.strictEqual(reduce(state, { type: 'send', phase: 'discussion', text: proposal }), state);
  for (const concern of ['좋아요', '이 기준으로 화면 안 보여주세요', '화면이 궁금하긴 해요', '화면을 만들지 마세요', '그럼 이 기준으로 화면 한번 볼까요? 아직 확정하지 마세요.', '이 기준으로 화면 한번 볼까요? 아직 결정하지 못했어요', '이 기준으로 화면 보되 실명은 그대로 둡시다']) {
    const guarded = send(state, concern);
    assert.equal(guarded.phase, 'agreement');
  }
  for (const text of ['결제 기능은 추가하지 마세요. 이 기준으로 화면 보여주세요.', '결제는 필요 없어요. 이 기준으로 화면 보여주세요.', '결제는 빼고 이 기준으로 화면 보여주세요.']) {
    const negativePayment = send(state, text);
    assert.equal(negativePayment.phase, 'agreement');
    assert.notEqual(negativePayment.pending?.kind, 'payment', 'negative mentions must not create a positive payment requirement');
  }
  // Whole requests must survive classification; extra scope and future timing are not assent.
  for (const [text, kind] of [
    ['이 방향으로 화면 만들어 주세요. 결제 기능도 추가해 주세요.', 'payment'],
    ['기존 화면 시안은 보여주세요. 결제도 넣으면 좋겠어요.', 'payment'],
    ['이 기준으로 화면 만들어 주는 건 다음 주에 하죠.', 'schedule'],
    ['이 기준으로 화면은 다음주에 보여주세요.', 'schedule'],
    ['다음 주 말고 지금 이 기준으로 화면 보여주세요.', 'clarify'],
    ['예산이 정해지면 이 기준으로 화면 만들어 주세요.', 'clarify'],
    ['예산이 정해지면 결제를 추가하고 이 기준으로 화면 만들어 주세요.', 'clarify'],
    ['이 기준으로 화면 보여주세요. 검색 기능도 추가해주세요.', 'clarify'],
    ['다음 주에 이 기준으로 화면을 만들고 결제도 추가해 주세요.', 'clarify'],
  ] as const) {
    const pending = send(state, text);
    assert.equal(pending.phase, 'agreement');
    assert.equal(pending.revision, 0);
    assert.equal(pending.pending?.kind, kind);
    assert.equal(pending.pending?.text, text, 'retain the whole request, including mixed conditions');
    assert.equal(pending.pending?.status, 'awaiting');
    assert.equal(send(pending, text).messages.length, pending.messages.length, 'duplicate clarification is not a new plan');
    assert.equal(send(pending, preview).phase, 'agreement', 'generic assent cannot bypass the pending decision');
    assert.strictEqual(reduce(pending, finish(pending)), pending);
    if (kind === 'payment') {
      assert.match(pending.messages.at(-1)!.text, /결제/, 'PM asks a scope-specific question');
      const oldPaymentChoice = choice(pending, 'preview_only');
      const additionallyDelayed = send(pending, '화면은 다음 주에 볼게요');
      assert.equal(additionallyDelayed.pending?.kind, 'clarify');
      assert.ok(additionallyDelayed.pending?.text.includes(text));
      assert.ok(additionallyDelayed.pending?.text.includes('화면은 다음 주에 볼게요'));
      assert.strictEqual(reduce(additionallyDelayed, oldPaymentChoice), additionallyDelayed, 'new constraints invalidate previously offered choices');
      const held = reduce(pending, choice(pending, 'hold'));
      assert.equal(held.pending?.status, 'held');
      assert.equal(held.phase, 'agreement');
      assert.strictEqual(reduce(held, choice(held, 'hold')), held);
      const limited = reduce(pending, choice(pending, 'preview_only'));
      assert.equal(limited.phase, 'executing');
      assert.equal(limited.pending?.status, 'deferred');
      assert.equal(limited.pending?.text, text, 'payment remains unresolved after original preview is authorized');
      assert.equal(reduce(limited, finish(limited)).pending?.status, 'deferred');
    } else if (kind === 'schedule') {
      const prepared = reduce(pending, choice(pending, 'prepare_only'));
      assert.equal(prepared.phase, 'agreement');
      assert.equal(prepared.pending?.status, 'prepared');
      assert.equal(prepared.revision, 0, 'preparation alone must not create a screen');
      assert.strictEqual(reduce(prepared, choice(prepared, 'prepare_only')), prepared);
      assert.equal(send(prepared, text).pending?.status, 'prepared');
      const now = reduce(prepared, choice(prepared, 'start_now'));
      assert.equal(now.phase, 'executing');
      assert.equal(now.pending?.status, 'resolved');
    } else {
      assert.strictEqual(reduce(pending, choice(pending, 'start_now')), pending, 'unknown scope cannot use a schedule override');
      assert.strictEqual(reduce(pending, choice(pending, 'preview_only')), pending);
    }
  }
  assert.strictEqual(reduce(state, finish(state)), state);
  state = send(state, preview);
  assert.equal(state.phase, 'executing', 'a clear preview invitation authorizes only the bounded next step');
  assert.strictEqual(reduce(state, { type: 'send', phase: 'agreement', text: preview }), state);
});

test('scripted scoped changes retain prior decisions and interrupted callbacks cannot finish replayed work', () => {
  let state = discussion();
  state = send(state, change); // Scope request is not the comparison judgment.
  assert.equal(state.phase, 'discussion');
  const beforePending = send(state, proposal);
  const pending = send(beforePending, '결제 기능도 추가해서 화면을 보여주세요.');
  const staleChoice = choice(pending, 'preview_only');
  const resetPending = reduce(pending, { type: 'reset' });
  assert.equal(resetPending.pending, undefined);
  assert.strictEqual(reduce(resetPending, staleChoice), resetPending);
  const heldPending = reduce(pending, choice(pending, 'hold'));
  const restoredPending = reduce(heldPending, { type: 'back' });
  assert.equal(restoredPending.pending?.status, 'awaiting');
  assert.strictEqual(reduce(restoredPending, staleChoice), restoredPending, 'back invalidates old choice callbacks even for the same request');
  const clearedPending = reduce(restoredPending, { type: 'back' });
  assert.equal(clearedPending.pending, undefined);
  assert.strictEqual(reduce(clearedPending, staleChoice), clearedPending);
  state = send(send(state, proposal), '이 기준대로 화면을 만들어 주세요.');
  assert.equal(state.phase, 'executing');
  const oldFinish = finish(state);
  const reset = reduce(state, { type: 'reset' });
  assert.equal(reset.phase, 'intro');
  assert.equal(reset.revision, 0);
  assert.strictEqual(reduce(reset, oldFinish), reset);
  state = reduce(state, { type: 'back' });
  assert.equal(state.phase, 'agreement');
  state = send(state, preview);
  assert.strictEqual(reduce(state, oldFinish), state, 'old completion cannot finish replayed execution');
  state = reduce(state, finish(state));
  assert.equal(state.phase, 'delivered');
  assert.equal(state.revision, 1);
  for (const concern of ['안내를 넣을지 아직 모르겠어요', 'fiction 안내는 추가하되 노래는 빼지 마세요', 'fiction 안내만 추가해 주세요', '노래만 제외해 주세요', 'fiction 안내를 빼고 노래를 추가해 주세요']) {
    const guarded = send(state, concern);
    assert.equal(guarded.phase, 'delivered', 'ambiguity, veto or incomplete scope must not authorize both changes');
  }
  for (const text of [
    'fiction 안내를 추가하고 노래는 빼주세요. 결제 기능도 추가해주세요.',
    'fiction 안내를 추가하고 노래는 다음 주에 빼주세요.',
    'fiction 안내를 추가하고 노래는 빼주세요. 검색도 넣어주세요.',
  ]) {
    const pendingChange = send(state, text);
    assert.equal(pendingChange.phase, 'delivered');
    assert.equal(pendingChange.revision, 1, 'mixed D2 requests must preserve the existing artifact');
    assert.equal(pendingChange.pending?.kind, 'clarify');
    assert.equal(pendingChange.pending?.text, text);
    assert.equal(send(pendingChange, change).phase, 'delivered', 'the normal revision sentence cannot discard an unresolved extra request');
    assert.strictEqual(reduce(pendingChange, finish(pendingChange)), pendingChange);
    const backToArtifact = reduce(pendingChange, { type: 'back' });
    assert.equal(backToArtifact.phase, 'delivered');
    assert.equal(backToArtifact.pending, undefined);
    assert.equal(backToArtifact.revision, 1);
  }
  state = send(state, change);
  assert.equal(state.phase, 'revising');
  assert.equal(state.revision, 1, 'v1 stays current while the limited revision is pending');
  const scope = state.messages.at(-1)!;
  assert.equal(scope.speaker, 'PM');
  assert.match(scope.text, /Story/);
  assert.match(scope.text, /UI/);
  assert.match(scope.text, /유지/, 'PM must state what is preserved as well as what changes');
  const beforeCompletion = state.messages.length;
  state = reduce(state, finish(state));
  assert.equal(state.phase, 'complete');
  assert.equal(state.revision, 2);
  const completed = state.messages.slice(beforeCompletion);
  assert.deepEqual(completed.slice(0, 2).map(m => m.speaker), ['Story', 'UI']);
  assert.equal(completed.at(-1)!.speaker, 'PM');
  assert.match(completed[0]!.text, /노래.*제외.*나머지.*유지/);
  assert.match(completed[1]!.text, /fiction.*추가.*노래.*제거/);
  assert.match(state.messages.at(-1)!.text, /검토/, 'PM reports comparison and returns final judgment to people');
  assert.strictEqual(reduce(state, finish(state)), state, 'duplicate completion is inert');
});
