import React, { useEffect, useRef, useState } from 'react';
import { GameState } from './engine/GameState';
import { SceneManager } from './rendering/SceneManager';
import { EnemyAIAgent } from './ai/EnemyAIAgent';
import { LLMService } from './ai/LLMService';
import { voiceService } from './ai/VoiceService';
import { sounds } from './engine/SoundEffects';
import { GameHUD } from './components/GameHUD';
import { EngineerPanel } from './components/EngineerPanel';
import { TacticalPanel } from './components/TacticalPanel';
import { AICoinTracker } from './components/AICoinTracker';
import { SettingsModal } from './components/SettingsModal';
import { VictoryModal } from './components/VictoryModal';
import { RobotDesign } from './types/robot';
import { AICoinTelemetry, TacticalDoctrine } from './types/game';
import { ChatMessage, LLMSettings } from './types/agent';
import { GAME_BALANCE } from './config/balance';

const DEFAULT_SETTINGS: LLMSettings = {
  provider: 'gemini',
  apiKey: '',
  model: 'gemini-1.5-flash',
  autoSpeakResponse: true,
  aiCoinLimit: GAME_BALANCE.AI_COIN_LIMIT_DEFAULT,
};

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const gameStateRef = useRef<GameState>(new GameState());
  const sceneManagerRef = useRef<SceneManager | null>(null);
  const enemyAIRef = useRef<EnemyAIAgent>(new EnemyAIAgent());
  const llmServiceRef = useRef<LLMService>(new LLMService(DEFAULT_SETTINGS));

  const [, setTick] = useState(0); // Force re-render for UI updates
  const [settings, setSettings] = useState<LLMSettings>(() => {
    try {
      const saved = localStorage.getItem('ironcore_llm_settings');
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_SETTINGS;
  });

  const [proposedDesign, setProposedDesign] = useState<RobotDesign | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init_1',
      role: 'engineer',
      text: 'База развёрнута, командир! Первая партия «Вектор Mk-I» заложена на заводе. Голосом или текстом отдавайте приказы по доработке вооружения и брони под обстановку на передовой.',
      timestamp: Date.now(),
    },
  ]);

  const [coinTelemetry, setCoinTelemetry] = useState<AICoinTelemetry>({
    coinBalance: GAME_BALANCE.INITIAL_COINS,
    coinsSpentTotal: 0,
    matchLimit: settings.aiCoinLimit,
    totalTokensIn: 0,
    totalTokensOut: 0,
    asrSecondsTotal: 0,
    ttsSecondsTotal: 0,
    lastRequestLatencyMs: 0,
    requestsCount: 0,
  });

  // Load settings into service on change
  useEffect(() => {
    llmServiceRef.current.updateSettings(settings);
    try {
      localStorage.setItem('ironcore_llm_settings', JSON.stringify(settings));
    } catch {}
  }, [settings]);

  // Init 3D Scene & Game Loop
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    const sceneManager = new SceneManager(container);
    sceneManagerRef.current = sceneManager;

    let lastTime = performance.now();
    let animId: number;

    const loop = (time: number) => {
      animId = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (time - lastTime) / 1000);
      lastTime = time;

      const state = gameStateRef.current;
      state.update(dt);
      enemyAIRef.current.update(state);
      sceneManager.render(state);

      // Trigger UI re-render at ~15fps for smooth numbers
      setTick(t => (t + 1) % 1000);
    };

    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      sceneManager.dispose();
    };
  }, []);

  // Handle Voice / Text Command to Engineer
  const handleSendPrompt = async (text: string) => {
    if (!text.trim() || isLoadingAI) return;

    sounds.playClick();
    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'system',
      text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoadingAI(true);

    const state = gameStateRef.current;
    const response = await llmServiceRef.current.requestEngineerRedesign(
      text,
      state.playerDesign,
      state.playerEconomy.metal
    );

    setIsLoadingAI(false);

    // Update Coin Telemetry (Section 10 of brief)
    setCoinTelemetry(prev => ({
      ...prev,
      coinBalance: Math.max(0, prev.coinBalance - response.costCoins),
      coinsSpentTotal: prev.coinsSpentTotal + response.costCoins,
      totalTokensIn: prev.totalTokensIn + response.tokensIn,
      totalTokensOut: prev.totalTokensOut + response.tokensOut,
      lastRequestLatencyMs: response.latencyMs,
      requestsCount: prev.requestsCount + 1,
    }));

    if (response.design) {
      setProposedDesign(response.design);
    }

    const engMsg: ChatMessage = {
      id: `eng_${Date.now()}`,
      role: 'engineer',
      text: response.messageRu,
      timestamp: Date.now(),
      proposedDesign: response.design,
    };
    setMessages(prev => [...prev, engMsg]);

    // TTS Voice Playback
    if (settings.autoSpeakResponse) {
      setIsSpeaking(true);
      voiceService.speak(response.messageRu, () => {
        setIsSpeaking(false);
      });
    }
  };

  // Toggle Voice Recognition
  const handleToggleListen = () => {
    if (isListening) {
      voiceService.stopListening();
      setIsListening(false);
      if (transcript.trim()) {
        handleSendPrompt(transcript.trim());
        setTranscript('');
      }
    } else {
      setTranscript('');
      setIsListening(true);
      voiceService.startListening(
        (text, isFinal) => {
          setTranscript(text);
          if (isFinal) {
            voiceService.stopListening();
            setIsListening(false);
            handleSendPrompt(text);
            setTranscript('');
          }
        },
        () => {
          setIsListening(false);
        },
        () => {
          setIsListening(false);
        }
      );
    }
  };

  // Apply Proposed Robot Design to Factory
  const handleApplyDesign = (design: RobotDesign) => {
    sounds.playClick();
    const state = gameStateRef.current;
    state.playerDesign = { ...design };
    setProposedDesign(null);

    // If factory is currently idle, immediately queue a batch
    const factory = state.buildings.find(b => b.team === 'player' && b.type === 'factory');
    if (factory && !factory.productionQueue) {
      state.queueBatch('player');
    }

    const confirmMsg: ChatMessage = {
      id: `confirm_${Date.now()}`,
      role: 'engineer',
      text: `Конфигурация «${design.name}» утверждена в серийное производство. Следующая партия выйдет с конвейера в этом исполнении!`,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, confirmMsg]);

    if (settings.autoSpeakResponse) {
      setIsSpeaking(true);
      voiceService.speak(confirmMsg.text, () => setIsSpeaking(false));
    }
  };

  // Tactical Doctrine update
  const handleUpdateDoctrine = (updated: Partial<TacticalDoctrine>) => {
    sounds.playClick();
    const state = gameStateRef.current;
    state.playerDoctrine = { ...state.playerDoctrine, ...updated };
  };

  // Restart match
  const handleRestartMatch = () => {
    sounds.playClick();
    gameStateRef.current = new GameState();
    setProposedDesign(null);
    setMessages([
      {
        id: `restart_${Date.now()}`,
        role: 'engineer',
        text: 'Матч перезапущен. Конвейеры чисты, ресурсы сброшены. Жду приказаний!',
        timestamp: Date.now(),
      },
    ]);
  };

  const state = gameStateRef.current;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-sans select-none">
      {/* 3D Three.js Game Canvas Container */}
      <div ref={canvasRef} className="absolute inset-0 z-0 cursor-default" />

      {/* Top HUD */}
      <GameHUD
        state={state}
        onTogglePause={() => {
          state.isPaused = !state.isPaused;
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onRestartMatch={handleRestartMatch}
      />

      {/* Floating Battle Event Ticker (Top center-left) */}
      <div className="absolute top-20 left-4 pointer-events-none z-10 flex flex-col gap-1.5 max-w-sm">
        {state.events.slice(0, 3).map((ev, i) => (
          <div
            key={i}
            className="text-xs bg-slate-900/80 border border-slate-700/60 text-slate-200 px-3 py-1.5 rounded-lg shadow-lg backdrop-blur-md flex items-center gap-2 animate-fade-in"
          >
            <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" />
            <span className="truncate">{ev.text}</span>
          </div>
        ))}
      </div>

      {/* Bottom Bar: Engineer Panel, Tactical Panel, AI Coin Tracker */}
      <div className="absolute bottom-4 left-4 right-4 pointer-events-none flex justify-between items-end z-20 gap-4">
        {/* Left: AI Chief Engineer Console */}
        <EngineerPanel
          currentDesign={state.playerDesign}
          proposedDesign={proposedDesign}
          onApplyDesign={handleApplyDesign}
          onSendVoiceOrText={handleSendPrompt}
          isListening={isListening}
          transcript={transcript}
          onToggleListen={handleToggleListen}
          isLoading={isLoadingAI}
          messages={messages}
          isSpeaking={isSpeaking}
        />

        {/* Right side: Tactical Panel + AI Coin Tracker */}
        <div className="flex flex-col gap-3 items-end">
          <TacticalPanel
            doctrine={state.playerDoctrine}
            onChangeDoctrine={handleUpdateDoctrine}
          />
          <AICoinTracker telemetry={coinTelemetry} />
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={s => setSettings(s)}
      />

      {/* Victory / Defeat Modal */}
      {state.gameOver && (
        <VictoryModal
          outcome={state.gameOver}
          state={state}
          onRestart={handleRestartMatch}
        />
      )}
    </div>
  );
};
