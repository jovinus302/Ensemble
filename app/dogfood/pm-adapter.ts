// PM 어댑터: Windows에서 PM CLI(claude -p)가 시스템 프롬프트와 해석 스키마를 명령줄 인자로 넘기기 때문에
// 사람 메시지가 쌓이면 32,767자 한도를 넘는다(llm/src/claude-cli.ts:46-54). 제품은 바꾸지 않고,
// 하네스가 주입하는 LlmProvider 래퍼에서 스키마를 의미가 같은 $defs/$ref로 압축하고, 그래도 넘으면 명시적으로 멈춘다.
import type { LlmProvider, LlmRequest, LlmResponse } from '@ensemble/llm';

type Json = Record<string, unknown>;

/** 압축 대상이 되는 하위 스키마의 최소 길이(JSON 문자 수)와 최소 반복 횟수. */
const MIN_CHARS = 200;
const MIN_COUNT = 2;
const REF_PREFIX = '#/$defs/';

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 키를 정렬한 JSON 문자열. 키 순서만 다른 같은 스키마를 같은 것으로 센다. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

type Setter = (replacement: unknown) => void;
/** isDef: $defs의 항목 자신인지(후보에서는 제외하되 내부는 훑는다). */
type ChildVisitor = (child: Json, set: Setter, isDef: boolean) => void;

const SCHEMA_ARRAY_KEYS = ['oneOf', 'anyOf', 'allOf', 'prefixItems'] as const;
const SCHEMA_MAP_KEYS = ['properties', 'patternProperties'] as const;
const SCHEMA_DEF_KEYS = ['$defs', 'definitions'] as const;
const SCHEMA_SINGLE_KEYS = ['items', 'additionalProperties', 'not', 'if', 'then', 'else'] as const;

/** 스키마가 놓이는 자리(properties의 값, items, oneOf 항목 …)의 하위 스키마만 돌려준다. properties 맵 자체는 스키마가 아니다. */
function eachChild(node: Json, visit: ChildVisitor): void {
  for (const key of SCHEMA_SINGLE_KEYS) {
    const child = node[key];
    if (isObject(child)) visit(child, (r) => { node[key] = r; }, false);
    else if (key === 'items' && Array.isArray(child)) {
      child.forEach((c, i) => { if (isObject(c)) visit(c, (r) => { child[i] = r; }, false); });
    }
  }
  for (const key of SCHEMA_ARRAY_KEYS) {
    const list = node[key];
    if (!Array.isArray(list)) continue;
    list.forEach((c, i) => { if (isObject(c)) visit(c, (r) => { list[i] = r; }, false); });
  }
  for (const key of SCHEMA_MAP_KEYS) {
    const map = node[key];
    if (!isObject(map)) continue;
    for (const name of Object.keys(map)) {
      const c = map[name];
      if (isObject(c)) visit(c, (r) => { map[name] = r; }, false);
    }
  }
  for (const key of SCHEMA_DEF_KEYS) {
    const map = node[key];
    if (!isObject(map)) continue;
    for (const name of Object.keys(map)) {
      const c = map[name];
      if (isObject(c)) visit(c, (r) => { map[name] = r; }, true);
    }
  }
}

function tally(node: Json, counts: Map<string, { count: number; size: number; sample: Json }>): void {
  eachChild(node, (child, _set, isDef) => {
    if (!isDef) {
      const key = canonical(child);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { count: 1, size: key.length, sample: child });
    }
    tally(child, counts);
  });
}

function replaceAll(node: Json, key: string, ref: Json): void {
  eachChild(node, (child, set, isDef) => {
    if (!isDef && canonical(child) === key) set({ ...ref });
    else replaceAll(child, key, ref);
  });
}

/**
 * 반복되는 큰 하위 스키마를 루트 $defs로 옮기고 {$ref}로 바꾼다. 의미는 같다(expandRefs로 되돌리면 원본과 deepEqual).
 * 200자 이상이면서 2회 이상 나오는 것을 큰 것부터 처리한다. 루트 자신은 제외하고, 이미 있는 $defs는 병합한다.
 */
export function compressSchema(schema: object): { schema: Json; defs: number } {
  const root = structuredClone(schema) as Json;
  const defs: Json = isObject(root.$defs) ? root.$defs : {};
  let next = 0;
  let created = 0;
  for (;;) {
    const counts = new Map<string, { count: number; size: number; sample: Json }>();
    tally(root, counts);
    let best: { key: string; size: number; sample: Json } | undefined;
    for (const [key, entry] of counts) {
      if (entry.count < MIN_COUNT || entry.size < MIN_CHARS) continue;
      if (!best || entry.size > best.size) best = { key, size: entry.size, sample: entry.sample };
    }
    if (!best) break;
    while (`d${next}` in defs) next += 1;
    const name = `d${next}`;
    defs[name] = structuredClone(best.sample);
    // 이후 반복에서 def 안쪽의 반복도 줄일 수 있도록 바로 루트에 붙인다.
    root.$defs = defs;
    replaceAll(root, best.key, { $ref: `${REF_PREFIX}${name}` });
    created += 1;
  }
  return { schema: root, defs: created };
}

/** compressSchema의 역변환(테스트용). 모든 $ref를 풀고 루트 $defs를 지운다. */
export function expandRefs(schema: object): Json {
  const root = structuredClone(schema) as Json;
  const defs = isObject(root.$defs) ? root.$defs : {};
  delete root.$defs;
  const expand = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(expand);
    if (!isObject(node)) return node;
    const ref = node.$ref;
    if (typeof ref === 'string' && ref.startsWith(REF_PREFIX)) {
      const target = defs[ref.slice(REF_PREFIX.length)];
      if (target === undefined) throw new Error(`알 수 없는 $ref입니다: ${ref}`);
      return expand(structuredClone(target));
    }
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, expand(v)]));
  };
  return expand(root) as Json;
}

/** Windows 명령줄 인용 규칙: 따옴표로 감싸고, 내부 "는 \"로, 따옴표 앞과 끝의 백슬래시는 두 배로. */
function winQuote(arg: string): string {
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes += 1;
    } else if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
    } else {
      out += '\\'.repeat(backslashes) + ch;
      backslashes = 0;
    }
  }
  return `${out}${'\\'.repeat(backslashes * 2)}"`;
}

function forcedToolOf(request: LlmRequest) {
  return request.forceTool ? request.tools?.find((t) => t.name === request.forceTool) : undefined;
}

/**
 * ClaudeCliProvider가 만드는 명령줄(llm/src/claude-cli.ts:46-54)의 길이 추정.
 * 고정 인자 + --system-prompt + --json-schema(강제 도구의 입력 스키마)를 Windows 규칙으로 인용해 합친다.
 * --model과 --effort는 짧아서 한도 여유(32,767 대 30,000)에 맡긴다.
 */
export function estimateArgvChars(request: LlmRequest): number {
  const tool = forcedToolOf(request);
  const args = [
    'claude', '-p', '--output-format', 'json', '--no-session-persistence',
    '--tools', '', '--strict-mcp-config', '--setting-sources', '',
    ...(request.system ? ['--system-prompt', request.system] : []),
    ...(tool ? ['--json-schema', JSON.stringify(tool.inputSchema)] : []),
  ];
  return args.map(winQuote).join(' ').length;
}

export interface MeteredUsage {
  ok: boolean;
  durationMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  tool?: string;
  error?: string;
}

export interface MeteredLlmOptions {
  onUsage(usage: MeteredUsage): void;
  /** true이면 강제 도구의 스키마를 $defs/$ref로 압축한다(win32 + claude PM). */
  schemaRef: boolean;
  /** 명령줄 추정 길이의 한도. 유한한 값일 때만 검사한다(api 런타임은 Infinity). */
  argvLimit: number;
  onOverflow(info: { chars: number; tool?: string }): void;
}

/** PM LlmProvider 래퍼: 사용량·시간을 하네스 원장으로 보내고, 필요하면 스키마를 압축하며, 명령줄 한도를 지킨다. */
export class MeteredLlm implements LlmProvider {
  constructor(private readonly inner: LlmProvider, private readonly o: MeteredLlmOptions) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    let sent = request;
    if (this.o.schemaRef) {
      const tool = forcedToolOf(request);
      if (tool) {
        const compressed = compressSchema(tool.inputSchema).schema;
        sent = { ...request, tools: request.tools!.map((t) => (t === tool ? { ...t, inputSchema: compressed } : t)) };
      }
    }
    if (Number.isFinite(this.o.argvLimit)) {
      const chars = estimateArgvChars(sent);
      if (chars > this.o.argvLimit) {
        const info = { chars, ...(request.forceTool ? { tool: request.forceTool } : {}) };
        this.o.onOverflow(info);
        // 제품은 이 예외를 LLM 실패로 다룬다. 하네스는 onOverflow로 알게 되어 argv_limit로 멈춘다.
        throw new Error('argv 한도 초과(하네스 어댑터)');
      }
    }
    const started = Date.now();
    try {
      const response = await this.inner.complete(sent);
      this.o.onUsage({
        ok: true,
        durationMs: Date.now() - started,
        model: response.model,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        ...(request.forceTool ? { tool: request.forceTool } : {}),
      });
      return response;
    } catch (error) {
      this.o.onUsage({
        ok: false,
        durationMs: Date.now() - started,
        model: request.model,
        inputTokens: 0,
        outputTokens: 0,
        ...(request.forceTool ? { tool: request.forceTool } : {}),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }
}
