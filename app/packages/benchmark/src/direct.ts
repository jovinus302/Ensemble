import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CodexAppServerClient, declineServerRequest } from '../../agents/src/codex/app-server.ts';
import { CLAUDE_DISALLOWED, codexWorkerArgs, DEVELOPMENT_SYSTEM } from './runtime-config.ts';
import type { NativeDriverOptions } from './native.ts';

/** Plain CLI transport: no task ledger, PM, judge, report fences or acknowledgement protocol. */
export async function createDirectDriver(options: NativeDriverOptions) {
  let client: CodexAppServerClient | undefined;
  let child: ChildProcess | undefined;
  let closed: Promise<void> = Promise.resolve();
  let threadId = randomUUID() as string;
  let sessionId: string | undefined;
  let workspace = '';
  let started = false;
  let stopped = false;
  let busy = false;
  let completed = false;
  let failure: unknown;
  let stopPromise: Promise<void> | undefined;
  let turnStarted = 0;
  const check = () => { options.signal.throwIfAborted(); if (stopped) throw new Error('Driver stopped'); if (failure) throw failure; };
  const finish = (status: string, error?: unknown) => {
    busy = false; completed = status === 'completed';
    if (error && !stopped) failure = error;
    options.record({ type: 'direct_worker_duration', status, elapsedMs: performance.now() - turnStarted, usage: null, underlyingApiCalls: null });
  };
  const startTurn = async (prompt: string) => {
    check(); if (busy) throw new Error('Direct worker is still running');
    busy = true; completed = false; turnStarted = performance.now();
    try {
      await options.meter('worker', async () => {
        check();
        if (client) { await client.turnStart({ threadId, text: prompt }); return; }
        const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
          ...(sessionId ? ['--resume', sessionId] : ['--session-id', threadId]),
          '--disallowedTools', CLAUDE_DISALLOWED.join(','), '--effort', options.effort,
          '--setting-sources', 'project', '--strict-mcp-config', '--model', options.model,
          '--append-system-prompt', DEVELOPMENT_SYSTEM];
        child = spawn('claude', args, { cwd: workspace, env: process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        const owned = child;
        closed = new Promise(resolve => owned.once('close', () => resolve()));
        sessionId ??= threadId;
        let rest = ''; let stderr = ''; let ok = false; let reason: string | undefined; let apiError: string | undefined;
        const line = (text: string) => {
          let event: Record<string, any>;
          try { event = JSON.parse(text); } catch { return; }
          if (typeof event.session_id === 'string') sessionId = event.session_id;
          if (event.type === 'assistant') {
            const text = (event.message?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
            if (event.is_api_error_message) apiError = text;
            else options.record({ type: 'direct_reply', text });
          }
          if (event.type === 'result') {
            ok = event.subtype === 'success' && !event.is_error;
            reason = event.error?.message ?? (ok ? undefined : event.result);
          }
        };
        owned.stdout!.setEncoding('utf8'); owned.stdout!.on('data', (chunk: string) => {
          const lines = (rest + chunk).split('\n'); rest = lines.pop() ?? ''; lines.forEach(line);
        });
        owned.stderr!.setEncoding('utf8'); owned.stderr!.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
        owned.once('error', error => { failure = error; });
        owned.once('close', (code, signal) => {
          line(rest);
          finish(stopped ? 'interrupted' : code === 0 && ok ? 'completed' : 'failed',
            code === 0 && ok ? undefined : failure ?? new Error(reason ?? apiError ?? `Claude exited ${code ?? signal}: ${stderr}`));
        });
        owned.stdin!.on('error', () => {}); owned.stdin!.end(prompt);
      });
    } catch (error) { busy = false; failure = error; throw error; }
  };
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopped = true;
    stopPromise = (async () => {
      options.signal.removeEventListener('abort', onAbort);
      if (child && child.exitCode === null && child.signalCode === null) child.kill();
      await Promise.all([client?.close(), closed]);
    })();
    return stopPromise;
  };
  const onAbort = () => { void stop().catch(error => { failure = error; }); };
  options.signal.addEventListener('abort', onAbort, { once: true });
  return {
    async start() {
      check(); if (started) throw new Error('Driver already started'); started = true;
      if (!/^[a-zA-Z0-9_-]+$/.test(options.projectId)) throw new Error('Unsafe project ID');
      await mkdir(options.workspaceRoot, { recursive: true });
      workspace = path.join(await realpath(options.workspaceRoot), options.projectId, 'prototype-agent');
      await mkdir(workspace, { recursive: true });
      if (path.relative(workspace, await realpath(workspace)) !== '') throw new Error('Workspace resolves outside its assigned path');
      await options.onWorkspace(workspace); check();
      if (options.provider === 'codex') {
        client = new CodexAppServerClient({ args: codexWorkerArgs(options.effort), serverRequestHandler: declineServerRequest });
        client.on('turn/completed', event => {
          if (event.threadId !== threadId || event.turn.status === 'inProgress') return;
          finish(event.turn.status, event.turn.status === 'completed' ? undefined : new Error(event.turn.error?.message ?? `Codex ${event.turn.status}`));
        });
        client.on('item/completed', event => {
          if (event.threadId === threadId && event.item.type === 'agentMessage') options.record({ type: 'direct_reply', text: event.item.text });
        });
        client.onFailure(error => { if (!stopped) { failure = error; busy = false; } });
        await client.initialize(); check();
        threadId = await client.threadStart({ cwd: workspace, sandbox: 'workspace-write', approvalPolicy: 'never', model: options.model, developerInstructions: DEVELOPMENT_SYSTEM });
      }
      options.record({ type: 'direct_config', provider: options.provider, model: options.model, effort: options.effort,
        systemInstructions: DEVELOPMENT_SYSTEM, reportingProtocol: 'plain', underlyingApiCalls: null, workerUsage: null });
      await startTurn(options.prompt);
    },
    async change(prompt: string) { check(); if (!started) throw new Error('Driver not started'); await startTurn(prompt); },
    async settled() { check(); return started && !busy && completed; },
    stop,
  };
}
