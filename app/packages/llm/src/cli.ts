import { spawn } from "node:child_process";
import type { LlmRequest } from "./types.ts";

// Shared pieces of the CLI-backed providers (Codex CLI, Claude CLI): one shell-free child process per
// request, the request rendered as a single prompt, and the forced tool emulated as structured output.
// The agents package spawns the same CLIs for long sessions; this is the one-shot variant for PM calls.

export interface CliProviderOptions {
  /** Defaults to the CLI name on PATH. Tests point it at `process.execPath` with a fake script. */
  executable?: string;
  executableArgs?: string[];
  /** Passed as `--model`; the CLI's own default model is used when absent. */
  model?: string;
  /** Reasoning effort (`--effort` / `model_reasoning_effort`); the CLI default when absent. */
  effort?: string;
  timeoutMs?: number;
  /** Working directory of the child; an empty temporary folder keeps project instructions out. */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export const DEFAULT_CLI_TIMEOUT_MS = 5 * 60_000;

export interface CliRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  /** The last 2000 characters: warnings there never fail a call on their own. */
  stderr: string;
}

export class CliError extends Error {
  constructor(message: string, readonly run?: CliRun) { super(message); }
}

/** Runs the CLI without a shell, writes `input` to stdin and resolves on exit; kills it on timeout. */
export function runCli(command: string, args: string[], input: string, options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number; label: string; signal?: AbortSignal }): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new CliError(`${options.label} cancelled`)); return; }
    let child;
    try {
      child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      reject(new CliError(`${options.label}를 실행하지 못했습니다: ${(error as Error).message}`));
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); fn(); } };
    const cancel = () => { cancelled = true; child.kill(); };
    const timeout = () => new CliError(`${options.label} 응답이 ${Math.round(options.timeoutMs / 1000)}초 안에 끝나지 않았습니다`, { code: null, signal: null, stdout, stderr });
    // The rejection waits for the exit (bounded) so the caller's cleanup never races a live process.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      setTimeout(() => settle(() => reject(timeout())), 5000).unref();
    }, options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
    child.once("error", error => settle(() => reject(new CliError(`${options.label}를 실행하지 못했습니다: ${error.message}`))));
    child.once("close", (code, signal) => settle(() => (cancelled ? reject(new CliError(`${options.label} cancelled`)) : timedOut ? reject(timeout()) : resolve({ code, signal, stdout, stderr }))));
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    child.stdin.on("error", () => { /* A dead process closes stdin; the exit reports the failure. */ });
    child.stdin.end(input);
  });
}

/** The whole request as one prompt; the system part stays separate when the CLI accepts it. */
export function renderPrompt(request: LlmRequest, options: { includeSystem: boolean }): string {
  const parts: string[] = [];
  if (options.includeSystem && request.system) parts.push(`# 지시\n${request.system}`);
  const single = request.messages.length === 1 && request.messages[0]!.role === "user";
  if (single) parts.push(request.messages[0]!.content);
  else parts.push(request.messages.map(m => `[${m.role}]\n${m.content}`).join("\n\n"));
  const tool = forcedTool(request);
  if (tool) parts.push(`# 응답 형식\n${tool.name} 도구 입력에 해당하는 JSON 객체 하나만 응답하세요. 설명: ${tool.description}`);
  return parts.join("\n\n");
}

export function forcedTool(request: LlmRequest) {
  if (!request.forceTool) return undefined;
  const tool = request.tools?.find(t => t.name === request.forceTool);
  if (!tool) throw new CliError(`forceTool ${request.forceTool} is not among the request tools`);
  return tool;
}

/** Reads a JSON object from model text, tolerating a surrounding code fence. */
export function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  let value: unknown;
  try { value = JSON.parse(fenced ? fenced[1]! : trimmed); }
  catch { throw new CliError(`구조화 응답이 JSON이 아닙니다: ${trimmed.slice(0, 200)}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CliError("구조화 응답이 JSON 객체가 아닙니다");
  return value as Record<string, unknown>;
}

type Schema = Record<string, unknown>;
const KEPT = new Set(["type", "enum", "const", "description", "properties", "required", "additionalProperties", "items", "anyOf"]);
const HINTED = ["minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "pattern", "format"];

/**
 * OpenAI strict structured output (Codex `--output-schema`): every object closes its properties and
 * requires all of them, so an optional property becomes nullable; `oneOf` becomes `anyOf`; bounds the
 * strict subset may reject become description hints. The caller's own validation still enforces them.
 */
export function strictSchema(schema: Schema): Schema {
  const out: Schema = {};
  const hints: string[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (key === "oneOf") out.anyOf = (value as Schema[]).map(strictSchema);
    else if (key === "anyOf") out.anyOf = (value as Schema[]).map(strictSchema);
    else if (key === "items") out.items = strictSchema(value as Schema);
    else if (HINTED.includes(key)) hints.push(`${key}=${JSON.stringify(value)}`);
    else if (KEPT.has(key) && key !== "properties" && key !== "required" && key !== "additionalProperties") out[key] = value;
  }
  // JSON Schema permits an untyped literal; Codex structured output requires an
  // explicit type. Infer only from actual values, never coerce or add enum members.
  if ('enum' in schema && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    throw new Error('Strict schema enum must be a non-empty array');
  }
  const literals = 'const' in schema ? [schema.const] : Array.isArray(schema.enum) ? schema.enum : undefined;
  if (literals) {
    const types = [...new Set(literals.map(literalType))];
    if (out.type === undefined) out.type = types.length === 1 ? types[0] : types;
  }
  if (schema.properties) {
    const properties = schema.properties as Record<string, Schema>;
    const required = new Set((schema.required as string[] | undefined) ?? []);
    out.properties = Object.fromEntries(Object.entries(properties).map(([name, child]) => {
      const strict = strictSchema(child);
      return [name, required.has(name) ? strict : nullable(strict)];
    }));
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  }
  if (hints.length) out.description = [out.description, `(${hints.join(", ")})`].filter(Boolean).join(" ");
  return out;
}

function literalType(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return typeof value;
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  // Object/array literals need structural schemas in the strict subset. Refuse
  // them here rather than synthesizing properties or silently widening values.
  throw new Error('Strict schema const/enum members must be finite JSON primitives');
}

function nullable(schema: Schema): Schema {
  if ('const' in schema || 'enum' in schema) return allowsNull(schema) ? schema : { anyOf: [schema, { type: 'null' }] };
  if (Array.isArray(schema.type)) return schema.type.includes("null") ? schema : { ...schema, type: [...schema.type, "null"] };
  if (typeof schema.type === "string" && !schema.enum) return { ...schema, type: [schema.type, "null"] };
  return { anyOf: [schema, { type: "null" }] };
}

/** Undoes `strictSchema` on a value: a null the original schema never allowed means "omitted". */
export function dropStrictNulls(value: unknown, schema: Schema): unknown {
  const branches = (s: Schema): Schema[] => {
    const union = (s.oneOf ?? s.anyOf) as Schema[] | undefined;
    return union ? union.flatMap(branches) : [s];
  };
  const candidates = branches(schema);
  if (Array.isArray(value)) {
    const items = candidates.map(c => c.items as Schema | undefined).filter((s): s is Schema => !!s);
    return value.map(v => items.length ? dropStrictNulls(v, { anyOf: items }) : v);
  }
  if (!value || typeof value !== "object") return value;
  const objects = candidates.filter(c => c.properties);
  if (!objects.length) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const owners = objects.filter(o => (o.properties as Record<string, Schema>)[key]);
    if (v === null && !owners.some(o => ((o.required as string[] | undefined) ?? []).includes(key) && allowsNull((o.properties as Record<string, Schema>)[key]!))) continue;
    const childSchemas = owners.map(o => (o.properties as Record<string, Schema>)[key]!);
    out[key] = childSchemas.length ? dropStrictNulls(v, { anyOf: childSchemas }) : v;
  }
  return out;
}

function allowsNull(schema: Schema): boolean {
  if (schema.type !== undefined && schema.type !== 'null' && !(Array.isArray(schema.type) && schema.type.includes('null'))) return false;
  if ('const' in schema) return schema.const === null;
  if (Array.isArray(schema.enum)) return schema.enum.includes(null);
  if (schema.type === "null" || (Array.isArray(schema.type) && schema.type.includes("null"))) return true;
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true;
  const union = (schema.oneOf ?? schema.anyOf) as Schema[] | undefined;
  return !!union?.some(allowsNull);
}
