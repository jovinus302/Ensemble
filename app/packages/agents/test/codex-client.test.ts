import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexAppServerClient, SteerRejectedError, type CodexNotifications } from '../src/codex/app-server.ts';
import { JsonRpcClient, RpcError, type RpcOptions } from '../src/codex/rpc.ts';

const fixture = fileURLToPath(new URL('./fixtures/fake-app-server.mjs', import.meta.url));
const options = { command: process.execPath, args: [fixture] };
const clients: { close(): Promise<void> }[] = [];
function rpc(extra: RpcOptions = {}) {
  const client = new JsonRpcClient({ ...options, ...extra }); clients.push(client); return client;
}
function app(extra: RpcOptions = {}) {
  const client = new CodexAppServerClient({ ...options, ...extra }); clients.push(client); return client;
}
function next<K extends keyof CodexNotifications>(client: CodexAppServerClient, method: K): Promise<CodexNotifications[K]> {
  return new Promise(resolve => {
    const off = client.on(method, value => { off(); resolve(value as CodexNotifications[K]); });
  });
}
afterEach(async () => { await Promise.all(clients.splice(0).map(client => client.close())); });

describe('Codex line-delimited transport', () => {
  it('matches concurrent, out-of-order responses amid notifications and chunked lines', async () => {
    const client = rpc();
    const notices: unknown[] = [];
    const order: number[] = [];
    client.on('notification', (method, params) => { if (method === 'test/interleaved') notices.push(params); });
    const requests = [60, 30, 0].map((delay, value) => client.request('test/echo', { delay, value }).then(result => {
      order.push(value); return result;
    }));
    expect(await Promise.all(requests)).toEqual([0, 1, 2]);
    expect(order).toEqual([2, 1, 0]);
    expect(notices).toEqual([{ value: 0 }, { value: 1 }, { value: 2 }]);
    expect(await client.request('test/chunked')).toBe('split 한글');
  });

  it('transmits large input through stdin and honors cwd/env', async () => {
    const cwd = fileURLToPath(new URL('./fixtures', import.meta.url));
    const client = rpc({ cwd, env: { ...process.env, CODEX_TEST_VALUE: 'present' } });
    const text = 'long input 한글\n'.repeat(20000);
    expect(await client.request('test/echo', { value: text })).toBe(text);
    expect(await client.request('test/context')).toEqual({ cwd, value: 'present' });
  });

  it.each(['test/exit', 'test/malformed'])('rejects all pending requests on %s', async method => {
    const client = rpc();
    const pending = [client.request('test/hang'), client.request('test/hang'), client.request(method)];
    const results = await Promise.allSettled(pending);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason.message.length).toBeLessThan(250);
        expect(result.reason.message).not.toMatch(/secret-token|private/);
      }
    }
    await expect(client.request('test/echo')).rejects.toThrow();
  });

  it('rejects pending requests on close and handles spawn failure', async () => {
    const client = rpc();
    const rejected = expect(client.request('test/hang')).rejects.toThrow('closed');
    await client.close(); await rejected; await client.close();
    const missing = rpc({ command: 'ensemble-missing-executable-for-test' });
    await expect(missing.request('initialize')).rejects.toThrow('could not start');
  });

  it('returns policy results, errors for throwing/empty/nonserializable handlers, and method-not-found', async () => {
    const policies = [
      { serverRequestHandler: () => ({ accepted: false }), expected: { result: { accepted: false } } },
      { serverRequestHandler: () => { throw new Error('secret'); }, expected: { error: { code: -32603, message: 'Server request handler failed' } } },
      { serverRequestHandler: () => undefined, expected: { error: { code: -32603 } } },
      { serverRequestHandler: () => 1n, expected: { error: { code: -32603 } } },
      { serverRequestHandler: undefined, expected: { error: { code: -32601 } } },
    ];
    for (const { serverRequestHandler, expected } of policies) {
      expect(await rpc({ serverRequestHandler }).request('test/handler')).toMatchObject(expected);
    }
  });
});

describe('Codex app-server methods', () => {
  it('initializes once, uses schema fields/defaults, and reads/resumes a thread', async () => {
    const client = app();
    const wire: { method: string; params?: unknown; jsonrpc?: unknown }[] = [];
    client.on('test/wire', message => wire.push(message as typeof wire[number]));
    expect(await Promise.all([client.initialize(), client.initialize()])).toEqual([
      expect.objectContaining({ userAgent: 'fake' }), expect.objectContaining({ userAgent: 'fake' }),
    ]);
    const threadId = await client.threadStart({ cwd: process.cwd(), developerInstructions: 'Be concise', model: 'fake' });
    expect(await client.threadResume(threadId, { excludeTurns: true })).toBe(threadId);
    expect(await client.threadRead(threadId, { includeTurns: true })).toMatchObject({ id: threadId, turns: [] });
    expect(wire.filter(message => message.method === 'initialize')).toHaveLength(1);
    expect(wire.find(message => message.method === 'initialize')).toMatchObject({ params: {
      clientInfo: { name: 'ensemble', title: 'Ensemble', version: '0.0.0' },
    } });
    expect(wire.filter(message => message.method === 'initialized')).toEqual([{ method: 'initialized' }]);
    expect(wire.find(message => message.method === 'thread/start')?.params).toEqual({
      cwd: process.cwd(), developerInstructions: 'Be concise', model: 'fake', sandbox: 'workspace-write', approvalPolicy: 'never',
    });
    expect(wire.every(message => !('jsonrpc' in message))).toBe(true);
  });

  it('answers all approval requests and unknown requests on the wire, allowing completion', async () => {
    const client = app();
    await client.initialize();
    const threadId = await client.threadStart();
    const answers = new Promise<unknown>(resolve => client.on('test/serverAnswers', resolve));
    const item = next(client, 'item/completed');
    const completed = next(client, 'turn/completed');
    const started = next(client, 'turn/started');
    const turnId = await client.turnStart({ threadId, text: 'run', clientUserMessageId: 'message-1' });
    expect((await started).turn.id).toBe(turnId);
    const responses = await answers as { method: string; response: { id: string | number; result?: unknown; error?: { code: number } } }[];
    expect(responses.map(answer => answer.response.result ?? answer.response.error)).toEqual([
      { decision: 'decline' }, { decision: 'decline' }, { permissions: {}, scope: 'turn' },
      { answers: {} }, { action: 'decline' }, { decision: 'abort' }, { decision: 'abort' },
      { code: -32601, message: 'Method not found' },
    ]);
    expect(new Set(responses.map(answer => typeof answer.response.id))).toEqual(new Set(['string', 'number']));
    const notification = await item;
    if (notification.item.type === 'agentMessage') expect(notification.item.text).toBe('fake answer');
    else throw new Error('Expected agent message');
    expect(await completed).toMatchObject({ threadId, turn: { id: turnId, status: 'completed' } });
    expect((await client.threadRead(threadId, { includeTurns: true })).turns[0]?.items).toEqual([notification.item]);
    expect((await client.threadRead(threadId, { includeTurns: false })).turns).toEqual([]);
  });

  it('steers only the expected active turn and interrupts with typed notifications', async () => {
    const client = app(); await client.initialize(); const threadId = await client.threadStart();
    const wire: unknown[] = []; client.on('test/wire', message => wire.push(message));
    const turnId = await client.turnStart({ threadId, text: 'hold' });
    await expect(client.turnSteer({ threadId, expectedTurnId: 'wrong', text: 'change', clientUserMessageId: 'u1' }))
      .rejects.toBeInstanceOf(SteerRejectedError);
    expect(await client.turnSteer({ threadId, expectedTurnId: turnId, text: 'new\ncontext', clientUserMessageId: 'u2' })).toBe(turnId);
    expect(wire).toContainEqual(expect.objectContaining({ method: 'turn/steer', params: {
      threadId, expectedTurnId: turnId, clientUserMessageId: 'u2', input: [{ type: 'text', text: 'new\ncontext', text_elements: [] }],
    } }));
    const completed = next(client, 'turn/completed');
    await client.turnInterrupt({ threadId, turnId });
    expect((await completed).turn.status).toBe('interrupted');
    await expect(client.turnSteer({ threadId, expectedTurnId: turnId, text: 'late', clientUserMessageId: 'u3' }))
      .rejects.toMatchObject({ name: 'SteerRejectedError', threadId, expectedTurnId: turnId, code: -32602 });
    await client.close();
    await expect(client.turnSteer({ threadId, expectedTurnId: turnId, text: 'closed', clientUserMessageId: 'u4' }))
      .rejects.not.toBeInstanceOf(RpcError);
  });

  it('supports a custom policy and notification unsubscribe', async () => {
    const client = app({ serverRequestHandler: () => ({ decision: 'cancel' }) });
    let calls = 0; const off = client.on('turn/started', () => { calls++; }); off();
    const answers = new Promise<unknown>(resolve => client.on('test/serverAnswers', resolve));
    const completed = next(client, 'turn/completed');
    await client.initialize(); const threadId = await client.threadStart();
    await client.turnStart({ threadId, text: 'run' });
    expect(await answers).toEqual(expect.arrayContaining([expect.objectContaining({ response: expect.objectContaining({ result: { decision: 'cancel' } }) })]));
    await completed; expect(calls).toBe(0);
  });
});
