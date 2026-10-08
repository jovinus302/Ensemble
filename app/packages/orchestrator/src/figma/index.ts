// Figma participation experiment (issue #78). Not re-exported from the orchestrator entry yet: hosts import
// this module directly until the path is verified against a real Figma account.
export { parseFigmaLink, nodeIdFromUrl, type FigmaLink, type FigmaLinkKind } from './link.ts';
export { FigmaRestClient, FigmaApiError, FIGMA_TOKEN_ENV, FIGMA_TOKEN_ENV_ALIAS, type FigmaClient, type FigmaComment, type FigmaFileSnapshot, type FigmaNodeSummary, type FigmaUser, type FigmaErrorKind, type PostCommentInput } from './client.ts';
export { FakeFigma } from './fake.ts';
export {
  figmaRequests, figmaSpaceItems, figmaMentions, figmaMentionItems, figmaChangeReports, pmCommentIds, isFigmaEvent,
  type FigmaEventPayloads, type FigmaEvent, type FigmaRequestView, type FigmaRequestStatus, type FigmaFollowUp, type FigmaSpaceItem, type FigmaOrigin, type FollowUpVerification,
  type FigmaMentionView, type FigmaMentionStatus, type FigmaMentionItem, type MentionTrigger, type MentionSelection, type FigmaChangeReport,
} from './ledger.ts';
export { mentionTriggers, mentionQuery, pmSignature, spaceContextItems, selectContextItems, composeMentionAnswer, type SpaceContextItem, type SpaceContextKind } from './mentions.ts';
export {
  FigmaBridge, FigmaBridgeError, composeComment, pmTag, mentionIdFor,
  type FigmaBridgeOptions, type ShareFigmaLinkInput, type PollResult, type MentionScan, type PollMentionsResult, type MentionComposer, type ReportChangeInput,
} from './bridge.ts';
