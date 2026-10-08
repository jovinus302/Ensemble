// AI PM. Planned modules: intake (classify channel input), handoff judge (`checked`),
// dispatch (auto-start within the approved plan, one start per trigger, action cap),
// prompt-slice (fixed context slots), team-template.
// The PM's exact responsibilities are settled with the user before M2.
export { SessionRunner } from './session-runner.ts';
export { ProjectManager } from './pm.ts';
export type { ProjectManagerOptions, MessageAttachment, PmPost } from './pm.ts';
export { TaskResolutionError } from './pm.ts';
export { Coordinator, followUpTitle } from './coordination.ts';
export { Dispatcher } from './dispatch.ts';
export { buildTaskContext, summarizeForHuman } from './context.ts';
export { judgeHandoff, quoteInText, quoteRelevant } from './handoff.ts';
export { proposePlan, startFreeProject, decidePlan, PlanDraftingError, type FreeStartResult } from './planning.ts';
export type { PlanInput, PlanDraft, PlanningMember } from './planning.ts';
export { decideAuthority } from './authority-flow.ts';
export { decideRequest, decisionAnswerMessageId, DecisionRequestError, type DecisionFlowOptions, type DecideExtra } from './decision-flow.ts';
export { runSweep, type SweepOptions } from './sweep.ts';
export { opsApplicable } from './op-validation.ts';
export { runDigest, digestText, type DigestOptions } from './digest.ts';
export { questionRequestId } from './dispatch.ts';
export type { TrustedValidator, ValidationInput, ValidationOutput, ValidationArtifact, ValidationOptions } from './validation.ts';
export { SpaceParticipation, ParticipationError, spaceContextMarkdown, llmRequestComposer, ruleRequestComposer, localSpaceOrigin } from './space-participation.ts';
export type { SpaceContext, ComposeInput, RequestComposer, SpaceParticipationOptions, LinkInput, LinkRequestIssued, PostInput, RequestInput, LiaisonOutcome, ParticipationErrorCode } from './space-participation.ts';
export { SlackCoordinator, slackMessageId, slackBindingFromConfig, ANY_SLACK_HUMAN, handleSlackEventsRequest, slackConfigFromEnv, SlackWebApi, SlackSocketModeClient, openSocketModeUrl } from './slack-coordination.ts';
export type { SlackCoordinatorOptions, SlackSpaceBinding, SlackProgress, ProactiveSettings, ProactiveTrigger, SlackReceiveOutcome, SlackProactiveOutcome, SlackEnvConfig, SlackEventCallback, SlackHttpResult } from './slack-coordination.ts';
