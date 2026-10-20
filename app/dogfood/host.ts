// in-process 호스트. 하네스 프로세스 안에서 WebRuntime을 직접 만들고, route.ts의 GET/POST를
// 127.0.0.1 node:http 어댑터로 노출한다. HTTP 어댑터는 에이전트의 curl과 규칙 모드의 GET 전용이다.
// 사람 역할의 행동(startFree, decide, resolveTask, message …)은 runtime의 공개 메서드를 직접 부른다.
// 제품 코드는 바꾸지 않는다. 제품에 닿는 연결은 모두 이 파일과 pm-adapter.ts의 어댑터다.
import { mkdirSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import { Readable } from 'node:stream';
import type { LedgerEvent } from '@ensemble/core';
import { pmRuntimeFromEnv, type LlmProvider } from '@ensemble/llm';
import type { WebRuntime } from '../apps/web/lib/runtime.ts';
import { ensureClaudeOnPath, resolveClaudeExecutable, type ClaudeResolution } from './claude.ts';
import { applyProductEnv, assertOutsideRepo, type DogfoodConfig, type RunLayout } from './config.ts';
import type { DogfoodLedger } from './ledger.ts';
import { MeteredLlm } from './pm-adapter.ts';

export interface HttpJsonOptions {
  method?: 'GET' | 'POST';
  /** Authorization: Bearer 토큰(Space 참여자). */
  token?: string;
  /** 있으면 JSON으로 보낸다. */
  body?: unknown;
  headers?: Record<string, string>;
}

export interface HttpJsonResult {
  status: number;
  /** 본문이 JSON이 아니면 undefined. */
  json: unknown;
  text: string;
}

/** 타임아웃 없는 node:http JSON 호출. 하네스가 제품 HTTP 어댑터를 호출할 때 쓴다(PM 호출은 오래 걸릴 수 있다). */
export function httpJson(url: string, o: HttpJsonOptions = {}): Promise<HttpJsonResult> {
  return new Promise((resolve, reject) => {
    const payload = o.body === undefined ? undefined : Buffer.from(JSON.stringify(o.body), 'utf8');
    const headers: Record<string, string | number> = { ...(o.headers ?? {}) };
    if (o.token !== undefined) headers.authorization = `Bearer ${o.token}`;
    if (payload) {
      headers['content-type'] = 'application/json; charset=utf-8';
      headers['content-length'] = payload.length;
    }
    const req = httpRequest(url, { method: o.method ?? (payload ? 'POST' : 'GET'), headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : undefined;
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode ?? 0, json, text });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

export interface DogfoodHost {
  runtime: WebRuntime;
  baseUrl: string;
  port: number;
  /** announceLinkCode로 모아 둔 연결 확인 코드를 한 번 꺼낸다. participantId를 생략하면 가장 최근 것이다. */
  takeLinkCode(participantId?: string): string | undefined;
  /** 현재 프로젝트의 제품 원장 이벤트. */
  events(): Promise<LedgerEvent[]>;
  projectId(): string;
  /** PM 요청의 명령줄 추정 길이가 한도를 넘은 적이 있으면 그 값(가장 큰 것). */
  argvOverflow(): { chars: number; tool?: string } | undefined;
  /** run_started.adapters에 기록할 제품 외 연결. */
  adapters: { pathPrepend: boolean; pmSchemaRef: boolean };
  /** live에서 claude 런타임을 쓸 때 해석한 실행 파일. */
  claude?: ClaudeResolution;
  close(): Promise<void>;
}

type RouteModule = typeof import('../apps/web/app/api/[...path]/route.ts');

const globalRuntime = globalThis as typeof globalThis & { ensembleRuntime?: unknown };

function toHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }
  return headers;
}

/** route.ts의 GET/POST를 /api/ 아래에서만 노출하는 node:http 서버. Request URL은 실제 listen 포트로 만든다. */
function createAdapter(route: RouteModule, portOf: () => number): Server {
  return createServer((req, res) => {
    void (async () => {
      try {
        const method = req.method ?? 'GET';
        if (method !== 'GET' && method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'method_not_allowed' } }));
          return;
        }
        // local-access.ts가 Host 헤더의 포트와 URL의 포트를 비교하므로 URL은 실제 포트로 만든다.
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${portOf()}`);
        if (!url.pathname.startsWith('/api/')) {
          res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'not_found' } }));
          return;
        }
        const parts = url.pathname.slice('/api/'.length).split('/').filter(Boolean).map((p) => decodeURIComponent(p));
        const aborter = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) aborter.abort();
        });
        const init: RequestInit & { duplex?: 'half' } = { method, headers: toHeaders(req.headers), signal: aborter.signal };
        if (method === 'POST') {
          init.body = Readable.toWeb(req) as unknown as ReadableStream;
          init.duplex = 'half';
        }
        const handler = method === 'GET' ? route.GET : route.POST;
        const response = await handler(new Request(url, init), { params: Promise.resolve({ path: parts }) });
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });
        res.writeHead(response.status, headers);
        if (!response.body) {
          res.end();
          return;
        }
        const stream = Readable.fromWeb(response.body as never);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
      } catch (error) {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'adapter_failed', message } }));
      }
    })();
  });
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') reject(new Error('HTTP 어댑터의 포트를 알 수 없습니다'));
      else resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    // SSE(/api/events)처럼 열려 있는 연결이 닫히지 않으면 close가 끝나지 않는다.
    server.closeAllConnections();
  });
}

/**
 * 호스트를 띄운다. 순서: runDir 검사 -> 폴더 -> 제품 환경 변수 -> (live) claude PATH 보정 -> PM 래퍼 ->
 * WebRuntime 생성 -> globalThis.ensembleRuntime -> route import -> HTTP 어댑터.
 * 주의: WebRuntime은 process.cwd()에서 app/ 디렉터리를 찾으므로 하네스는 app/에서 실행한다.
 */
export async function startHost(config: DogfoodConfig, layout: RunLayout, ledger: DogfoodLedger): Promise<DogfoodHost> {
  assertOutsideRepo(config.runDir);
  mkdirSync(layout.root, { recursive: true });
  applyProductEnv(config, layout);

  const live = config.mode === 'live';
  const usesClaude = live && (config.pmRuntime === 'claude' || config.agentRuntime === 'claude');
  let claude: ClaudeResolution | undefined;
  let pathPrepend = false;
  if (usesClaude) {
    claude = resolveClaudeExecutable();
    pathPrepend = ensureClaudeOnPath(claude.exe, process.env);
  }

  const pmSchemaRef = live && process.platform === 'win32' && config.pmRuntime === 'claude';
  let overflow: { chars: number; tool?: string } | undefined;
  let llm: MeteredLlm | undefined;
  if (live) {
    llm = new MeteredLlm(pmRuntimeFromEnv().llm, {
      schemaRef: pmSchemaRef,
      // api 런타임은 명령줄을 쓰지 않으므로 한도를 두지 않는다.
      argvLimit: config.pmRuntime === 'claude' ? config.argvLimit : Number.POSITIVE_INFINITY,
      onOverflow: (info) => {
        if (overflow === undefined || info.chars > overflow.chars) overflow = info;
      },
      onUsage: (u) => {
        void ledger
          .record('dogfood_usage_recorded', {
            source: 'pm',
            role: 'ensemble-pm',
            ok: u.ok,
            model: u.model,
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            cacheReadTokens: null,
            cacheCreationTokens: null,
            durationMs: u.durationMs,
            ...(u.tool ? { tool: u.tool } : {}),
            ...(u.error ? { error: u.error } : {}),
          })
          .catch(() => undefined);
      },
    });
  }

  const codes = new Map<string, string>();
  let lastParticipant: string | undefined;
  const { WebRuntime } = await import('../apps/web/lib/runtime.ts');
  const runtime = new WebRuntime({
    dataDir: layout.data,
    timers: live,
    ...(live ? { llm: llm as LlmProvider } : { fakeAgentDelayMs: 50 }),
    announceLinkCode: (notice) => {
      codes.set(notice.participantId, notice.code);
      lastParticipant = notice.participantId;
    },
  });
  globalRuntime.ensembleRuntime = runtime;

  // 안전망: WebRuntime 생성 중 loadEnv()가 SLACK_*를 되살렸다면 실제 Slack 연동이 켜지므로 중단한다.
  const slackLeft = Object.keys(process.env).filter((k) => k.startsWith('SLACK_'));
  if (slackLeft.length > 0) {
    await runtime.stop().catch(() => undefined);
    if (llm) await llm.close().catch(() => undefined);
    if (globalRuntime.ensembleRuntime === runtime) delete globalRuntime.ensembleRuntime;
    throw new Error(`SLACK_* 환경 변수가 남아 있어 중단합니다(Iter 1·2는 Slack 제외): ${slackLeft.join(', ')}`);
  }

  let server: Server | undefined;
  const teardown = async () => {
    if (server) await closeServer(server).catch(() => undefined);
    await runtime.stop().catch(() => undefined);
    if (llm) await llm.close().catch(() => undefined);
    if (globalRuntime.ensembleRuntime === runtime) delete globalRuntime.ensembleRuntime;
  };

  let port = 0;
  try {
    // route.ts는 요청마다 getRuntime()을 부르므로 첫 요청 전에만 위 global이 있으면 된다.
    const route = await import('../apps/web/app/api/[...path]/route.ts');
    server = createAdapter(route, () => port);
    port = await listen(server, config.port);
    await runtime.state('owner');
  } catch (error) {
    await teardown();
    throw error;
  }

  let closed = false;
  return {
    runtime,
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    takeLinkCode(participantId) {
      const id = participantId ?? lastParticipant;
      if (id === undefined) return undefined;
      const code = codes.get(id);
      codes.delete(id);
      return code;
    },
    events: () => runtime.store.read({ projectId: runtime.meta.projectId }),
    projectId: () => runtime.meta.projectId,
    argvOverflow: () => overflow,
    adapters: { pathPrepend, pmSchemaRef },
    ...(claude ? { claude } : {}),
    async close() {
      if (closed) return;
      closed = true;
      await teardown();
    },
  };
}
