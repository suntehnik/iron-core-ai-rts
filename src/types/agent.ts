import { RobotDesign } from './robot';
import { TacticalDoctrine } from './game';

export type AgentRole = 'engineer' | 'tactical' | 'enemy' | 'system';

export interface ChatMessage {
  id: string;
  role: AgentRole;
  text: string;
  timestamp: number;
  audioPlayed?: boolean;
  proposedDesign?: RobotDesign;
  proposedDoctrine?: Partial<TacticalDoctrine>;
  tokensUsed?: number;
  costCoins?: number;
}

export type LLMProviderType = 'gemini' | 'openai' | 'groq' | 'anthropic' | 'mock';

export interface LLMSettings {
  provider: LLMProviderType;
  apiKey: string;
  model: string;
  apiEndpoint?: string;
  autoSpeakResponse: boolean;
  aiCoinLimit: number;
}

export interface VoiceState {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  isSupported: boolean;
  isSpeaking: boolean;
  error?: string;
}
