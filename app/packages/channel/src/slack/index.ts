// Slack transport for the PM Agent (issue #79, EXPERIMENT). Space binding and flows live in
// @ensemble/orchestrator (slack-coordination.ts).
export * from './signature.ts';
export * from './api.ts';
export * from './events.ts';
export { FakeSlackApi } from './fake.ts';
