import { PRIORITIES, RANGES, STANCES } from '../ai/parsing';
import { PAD_BUILDINGS } from '../config/balance';
import { CHASSIS_IDS } from '../config/catalog';
import { PROVIDER_ORDER } from '../config/llmProviders';
import { LANGS } from '../i18n/core';
import { BuildingType, PadBuildingType } from '../types/game';
import { ChassisType } from '../types/robot';

/**
 * Every analytics event the game may send and every parameter it may carry. A value is a number, a
 * boolean or a string from a fixed list, so free text (chat, orders, commander instructions, model
 * replies and taunts, model names, base URLs, keys) cannot reach analytics: the types refuse it at
 * compile time and validateEvent() at run time. The table in README «Аналитика» explains each event.
 */

interface IntSpec {
  kind: 'int';
  min: number;
  max: number;
  optional?: true;
}
interface BoolSpec {
  kind: 'bool';
  optional?: true;
}
interface EnumSpec<T extends string> {
  kind: 'enum';
  values: readonly T[];
  optional?: true;
}
type ParamSpec = IntSpec | BoolSpec | EnumSpec<string>;

const int = (min: number, max: number): IntSpec => ({ kind: 'int', min, max });
const bool: BoolSpec = { kind: 'bool' };
const oneOf = <T extends string>(values: readonly T[]): EnumSpec<T> => ({ kind: 'enum', values });
const optional = <S extends ParamSpec>(spec: S): S & { optional: true } => ({ ...spec, optional: true });

export const MODES = ['human', 'spectator'] as const;
/** The provider as a kind: no LLM, the on-device model, a server on this machine or network, the dev proxy, a cloud API. */
export const PROVIDER_KINDS = ['none', 'device', 'local', 'proxy', 'cloud'] as const;
/** 'won'/'lost' are for the teal side (the player; the teal AI in AI vs AI); 'closed' — the tab was closed mid-match. */
export const OUTCOMES = ['won', 'lost', 'restart', 'quit', 'closed'] as const;
/** Match length in game time. */
export const DURATION_BUCKETS = ['0-2m', '2-5m', '5-10m', '10-15m', '15-20m', '20-30m', '30m+'] as const;
/** Mean latency of the successful LLM calls of a match. */
export const LATENCY_BUCKETS = ['none', '0-1s', '1-3s', '3-10s', '10-30s', '30s+'] as const;
/** How an LLM call ended: 'ok' or the kind of failure (never the error text). */
export const LLM_RESULTS = ['ok', 'not_configured', 'no_coins', 'network', 'timeout', 'parse', 'auth', 'rate_limit', 'server', 'http', 'device'] as const;
export const VOICE_RESULTS = ['final', 'stopped', 'denied', 'error', 'unsupported', 'no_coins'] as const;
export const PLAN_FIELDS = ['stance', 'range', 'target', 'retreat', 'guard', 'revert'] as const;
const BUILT: readonly Exclude<BuildingType, 'command_center'>[] = ['factory', 'power_plant', ...(Object.keys(PAD_BUILDINGS) as PadBuildingType[])];

const COUNT = int(0, 1_000_000);
const LEVEL = int(1, 100_000);
const AGENT = oneOf(['engineer', 'tactician'] as const);
const SOURCE = oneOf(['llm', 'fallback'] as const);
const PROVIDER = oneOf(PROVIDER_ORDER);
const PROVIDER_KIND = oneOf(PROVIDER_KINDS);

export const EVENTS = {
  match_start: {
    mode: oneOf(MODES),
    level: LEVEL,
    endless: bool,
    lang: oneOf(LANGS),
    provider: PROVIDER,
    provider_kind: PROVIDER_KIND,
    llm_ready: bool,
    enemy_llm: bool,
  },
  match_end: {
    mode: oneOf(MODES),
    level: LEVEL,
    endless: bool,
    outcome: oneOf(OUTCOMES),
    duration: oneOf(DURATION_BUCKETS),
    units_built: COUNT,
    units_lost: COUNT,
    kills: COUNT,
    harvesters_lost: COUNT,
  },
  /** LLM use of one match, sent once at its end (never per call). */
  llm_match: {
    mode: oneOf(MODES),
    level: LEVEL,
    provider: PROVIDER,
    provider_kind: PROVIDER_KIND,
    calls: COUNT,
    errors: COUNT,
    fallback_pct: int(0, 100),
    latency: oneOf(LATENCY_BUCKETS),
    err_network: COUNT,
    err_timeout: COUNT,
    err_parse: COUNT,
    err_auth: COUNT,
    err_rate_limit: COUNT,
    err_server: COUNT,
    err_http: COUNT,
    err_device: COUNT,
    err_not_configured: COUNT,
    err_no_coins: COUNT,
    orders: COUNT,
    orders_queued: COUNT,
    orders_refused: COUNT,
  },
  campaign_progress: { level: LEVEL, unlocked: LEVEL },
  level_pick: { level: LEVEL, unlocked: LEVEL },
  agent_order: { agent: AGENT, input: oneOf(['text', 'voice', 'quick'] as const) },
  proposal_decision: { decision: oneOf(['confirm', 'cancel'] as const), source: SOURCE, has_design: bool, actions: int(0, 50) },
  design_change: { chassis: oneOf(CHASSIS_IDS as ChassisType[]), source: SOURCE },
  design_trial: { cached: bool },
  plan_change: {
    field: oneOf(PLAN_FIELDS),
    stance: optional(oneOf(STANCES)),
    range: optional(oneOf(RANGES)),
    target: optional(oneOf(PRIORITIES)),
  },
  building_built: { building: oneOf(BUILT) },
  voice_input: { result: oneOf(VOICE_RESULTS) },
  language_change: { lang: oneOf(LANGS), in_match: bool },
  llm_test: { provider: PROVIDER, provider_kind: PROVIDER_KIND, result: oneOf(LLM_RESULTS) },
} satisfies Record<string, Record<string, ParamSpec>>;

/** User properties: segment players by campaign progress. Never a user id. */
export const USER_PROPERTIES = {
  highest_level: LEVEL,
} satisfies Record<string, ParamSpec>;

type ValueOf<S> = S extends EnumSpec<infer T> ? T : S extends IntSpec ? number : S extends BoolSpec ? boolean : never;
type Params<P> = { [K in keyof P as P[K] extends { optional: true } ? never : K]: ValueOf<P[K]> } & {
  [K in keyof P as P[K] extends { optional: true } ? K : never]?: ValueOf<P[K]>;
};

export type EventName = keyof typeof EVENTS;
export type EventParams<E extends EventName> = Params<(typeof EVENTS)[E]>;
export type UserPropertyName = keyof typeof USER_PROPERTIES;
export type UserPropertyValue<P extends UserPropertyName> = ValueOf<(typeof USER_PROPERTIES)[P]>;
export type AnalyticsValue = string | number | boolean;
export type OutcomeKind = (typeof OUTCOMES)[number];
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export type LLMResult = (typeof LLM_RESULTS)[number];
export type VoiceResult = (typeof VOICE_RESULTS)[number];
export type PlanField = (typeof PLAN_FIELDS)[number];

// Does not compile if an enum parameter accepts any string: free text must stay impossible by type.
type WideKeys<P> = { [K in keyof P]: P[K] extends EnumSpec<infer T> ? (string extends T ? K : never) : never }[keyof P];
type WideParams = { [E in EventName]: WideKeys<(typeof EVENTS)[E]> }[EventName] | WideKeys<typeof USER_PROPERTIES>;
const noFreeText: [WideParams] extends [never] ? true : never = true;
void noFreeText;

export type Validation = { ok: true; params: Record<string, AnalyticsValue> } | { ok: false; error: string };

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function validValue(spec: ParamSpec, v: unknown): v is AnalyticsValue {
  switch (spec.kind) {
    case 'int':
      return typeof v === 'number' && Number.isInteger(v) && v >= spec.min && v <= spec.max;
    case 'bool':
      return typeof v === 'boolean';
    case 'enum':
      return typeof v === 'string' && spec.values.includes(v);
  }
}

/** Checks a parameter set against its spec. Errors name the parameter, never its value (it may be text). */
function validate(specs: Record<string, ParamSpec>, params: Record<string, unknown>, where: string): Validation {
  const out: Record<string, AnalyticsValue> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!has(specs, key)) return { ok: false, error: `${where}: parameter "${key}" is not allowed` };
    const spec = specs[key];
    if (value === undefined && spec.optional) continue;
    if (!validValue(spec, value)) return { ok: false, error: `${where}: "${key}" has a value outside its ${spec.kind} spec` };
    out[key] = value;
  }
  for (const [key, spec] of Object.entries(specs)) {
    if (!spec.optional && !has(out, key)) return { ok: false, error: `${where}: "${key}" is missing` };
  }
  return { ok: true, params: out };
}

export function validateEvent(name: string, params: Record<string, unknown>): Validation {
  if (!has(EVENTS, name)) return { ok: false, error: `unknown event "${name}"` };
  return validate(EVENTS[name as EventName] as Record<string, ParamSpec>, params, name);
}

export function validateUserProperty(name: string, value: unknown): Validation {
  if (!has(USER_PROPERTIES, name)) return { ok: false, error: `unknown user property "${name}"` };
  return validate({ [name]: USER_PROPERTIES[name as UserPropertyName] }, { [name]: value }, 'user property');
}
