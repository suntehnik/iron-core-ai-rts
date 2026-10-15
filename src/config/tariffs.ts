/**
 * Published AI tariffs in game coins (brief §10).
 *
 * The coin is a separate payment balance, unrelated to metal/components/power.
 * Numbers are a TEST tariff: they make the per-service breakdown visible while the
 * real cost of a typical match is being measured. Real payments are out of scope.
 */
export const AI_TARIFFS = {
  /** coins per 1000 input tokens of agent inference */
  LLM_INPUT_PER_1K: 0.4,
  /** coins per 1000 output tokens of agent inference */
  LLM_OUTPUT_PER_1K: 1.6,
  /** minimal charge per successful inference call */
  LLM_MIN_CHARGE: 0.1,
  /** coins per second of recognised speech */
  ASR_PER_SEC: 0.05,
  /** coins per second of synthesised speech */
  TTS_PER_SEC: 0.03,
  /** rough speech rate used to estimate TTS duration from text */
  TTS_CHARS_PER_SEC: 14,
};

export const AI_WALLET = {
  /** test balance granted on first launch */
  INITIAL_TEST_BALANCE: 150,
  /** one click on "top up test balance" */
  TEST_TOP_UP: 100,
  /** default per-match AI spending limit, editable by the player */
  DEFAULT_MATCH_LIMIT: 40,
  /** warn the player in advance when less than this share of the limit is left */
  LOW_BALANCE_SHARE: 0.2,
};

/** Estimate used for the pre-flight affordability check of one agent call. */
export function estimateLLMCost(expectedIn: number, expectedOut: number): number {
  return Math.max(
    AI_TARIFFS.LLM_MIN_CHARGE,
    (expectedIn / 1000) * AI_TARIFFS.LLM_INPUT_PER_1K + (expectedOut / 1000) * AI_TARIFFS.LLM_OUTPUT_PER_1K,
  );
}

export function llmCost(tokensIn: number, tokensOut: number): number {
  return estimateLLMCost(tokensIn, tokensOut);
}
