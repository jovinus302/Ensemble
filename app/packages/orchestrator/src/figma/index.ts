// Figma participation experiment (issue #78). Not re-exported from the orchestrator entry yet: hosts import
// this module directly until the path is verified against a real Figma account.
export { parseFigmaLink, nodeIdFromUrl, type FigmaLink, type FigmaLinkKind } from './link.ts';
export { FigmaRestClient, FigmaApiError, FIGMA_TOKEN_ENV, FIGMA_TOKEN_ENV_ALIAS, type FigmaClient, type FigmaComment, type FigmaFileSnapshot, type FigmaNodeSummary, type FigmaUser, type FigmaErrorKind, type PostCommentInput } from './client.ts';
export { FakeFigma } from './fake.ts';
export { figmaRequests, figmaSpaceItems, isFigmaEvent, type FigmaEventPayloads, type FigmaEvent, type FigmaRequestView, type FigmaRequestStatus, type FigmaFollowUp, type FigmaSpaceItem, type FigmaOrigin, type FollowUpVerification } from './ledger.ts';
export { FigmaBridge, FigmaBridgeError, composeComment, pmTag, type FigmaBridgeOptions, type ShareFigmaLinkInput, type PollResult } from './bridge.ts';
