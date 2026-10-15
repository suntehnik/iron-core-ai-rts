import { LLMProviderId } from '../config/llmProviders';
import { CalculatedRobotStats, RobotDesign } from './robot';
import { ProductionAction, TacticalPlan } from './game';

export type AgentId = 'engineer' | 'tactician';
export type ChatRole = AgentId | 'commander' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** addressee of a commander message */
  to?: AgentId;
  text: string;
  timestamp: number;
  source?: 'llm' | 'fallback' | 'local';
  latencyMs?: number;
  costCoins?: number;
}

/** Engineer proposal awaiting the player's confirmation (brief §5). */
export interface ProductionProposal {
  id: string;
  order: string;
  replyRu: string;
  compromiseRu?: string;
  design: RobotDesign | null;
  stats: CalculatedRobotStats | null;
  prevDesign: RobotDesign;
  prevStats: CalculatedRobotStats;
  actions: ProductionAction[];
  warnings: string[];
  source: 'llm' | 'fallback';
  repaired: boolean;
}

export interface TacticalDecision {
  replyRu: string;
  plan: TacticalPlan;
  previous: TacticalPlan;
  source: 'llm' | 'fallback';
  autonomous: boolean;
}

export interface LLMSettings {
  provider: LLMProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
  /** enemy commander also thinks with the cloud LLM */
  enemyUsesLLM: boolean;
  /** autonomous tactical re-plans on significant battle events */
  autonomousTactics: boolean;
  /** brief §10 open decision: include the AI opponent into the player's tariff */
  chargeEnemyToPlayer: boolean;
  autoSpeakResponse: boolean;
  matchCoinLimit: number;
  soundMuted: boolean;
}

export interface VoiceState {
  isListening: boolean;
  transcript: string;
  isSupported: boolean;
  isSpeaking: boolean;
  error?: string;
}
