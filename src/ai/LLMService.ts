import { CHASSIS_CATALOG, MODULES_CATALOG } from '../config/catalog';
import { LLMSettings } from '../types/agent';
import { RobotDesign } from '../types/robot';

export interface LLMAgentResponse {
  messageRu: string;
  design?: RobotDesign;
  doctrineUpdate?: {
    engagementRange?: 'max_range' | 'balanced' | 'close_brawl';
    targetPriority?: 'closest' | 'high_threat_heavies' | 'scouts_harvesters' | 'focus_fire';
  };
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  costCoins: number;
}

export class LLMService {
  private settings: LLMSettings;

  constructor(settings: LLMSettings) {
    this.settings = settings;
  }

  public updateSettings(settings: LLMSettings) {
    this.settings = settings;
  }

  public async requestEngineerRedesign(
    userPrompt: string,
    currentDesign: RobotDesign,
    metalAvailable: number
  ): Promise<LLMAgentResponse> {
    const startTime = performance.now();

    // If no key or mock provider, use intelligent local heuristic
    if (!this.settings.apiKey || this.settings.provider === 'mock') {
      return this.handleLocalMock(userPrompt, currentDesign, startTime);
    }

    try {
      if (this.settings.provider === 'gemini') {
        return await this.callGeminiAPI(userPrompt, currentDesign, metalAvailable, startTime);
      } else {
        // OpenAI / Groq / OpenRouter / Custom compatible API
        return await this.callOpenAICompatibleAPI(userPrompt, currentDesign, metalAvailable, startTime);
      }
    } catch (err) {
      console.warn('Cloud LLM call failed, falling back to local engineer logic:', err);
      const fallback = this.handleLocalMock(userPrompt, currentDesign, startTime);
      fallback.messageRu = `[Облачный API недоступен, сработал локальный сопроцессор]: ${fallback.messageRu}`;
      return fallback;
    }
  }

  private async callGeminiAPI(
    prompt: string,
    current: RobotDesign,
    metalAvailable: number,
    startTime: number
  ): Promise<LLMAgentResponse> {
    const model = this.settings.model || 'gemini-1.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.settings.apiKey}`;

    const systemInstruction = `Ты — Главный Инженер «Болт», циничный, но преданный инженер-конструктор боевых роботов в RTS.
Твоя цель: перевести приказ командира в конкретную спецификацию боевого робота из каталога деталей.
Каталог шасси:
- 'light_biped': легкий шагоход (лимит слотов 3, макс масса 650кг, база металл 75)
- 'medium_tracked': средний гусеничный (лимит слотов 5, макс масса 1400кг, база металл 150)
- 'heavy_quad': тяжелый квадропод (лимит слотов 7, макс масса 2600кг, база металл 280)

Каталог модулей:
- Броня: 'light_composite' (легкий композит), 'reinforced_steel' (усиленная сталь), 'sloped_reactive' (тяжелая динамическая)
- Оружие: 'autocannon_20mm' (автопушка 20мм), 'plasma_blasters' (плазмометы), 'heavy_siege_cannon' (тяжелая пушка 120мм), 'sniper_railgun' (рельсотрон), 'melee_buzzsaw' (пила)
- Двигатели: 'micro_turbine' (турбина, +скорость), 'diesel_electric' (дизель-генератор, +энергия)
- Утилиты: 'heat_radiator' (радиатор охлаждения), 'radar_sensor' (радар)

Текущий металл на базе: ${metalAvailable}.
Текущий дизайн робота: ${JSON.stringify(current)}.

Ты ОБЯЗАН вернуть строго валидный JSON следующей структуры:
{
  "messageRu": "Краткий ответ инженера игроку голосом (1-2 предложения, объясняющие выбор и компромиссы).",
  "name": "Новое название модели",
  "chassisId": "light_biped" | "medium_tracked" | "heavy_quad",
  "modules": ["id_модуля1", "id_модуля2", ...],
  "tacticalRole": "frontline" | "artillery" | "skirmisher" | "anti_armor"
}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemInstruction}\n\nПриказ игрока: "${prompt}"` }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Gemini HTTP Error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(rawText);

    const latencyMs = Math.round(performance.now() - startTime);
    const tokensIn = data.usageMetadata?.promptTokenCount || 280;
    const tokensOut = data.usageMetadata?.candidatesTokenCount || 85;

    const newDesign: RobotDesign = {
      id: `custom_${Date.now()}`,
      name: parsed.name || 'Модернизированный Mk',
      chassisId: parsed.chassisId || current.chassisId,
      modules: Array.isArray(parsed.modules) ? parsed.modules : current.modules,
      color: current.color,
      version: current.version + 1,
      createdAt: Date.now(),
      tacticalRole: parsed.tacticalRole || 'frontline',
    };

    return {
      messageRu: parsed.messageRu || 'Чертежи обновлены, отправляю спецификацию на конвейер.',
      design: newDesign,
      tokensIn,
      tokensOut,
      latencyMs,
      costCoins: 4,
    };
  }

  private async callOpenAICompatibleAPI(
    prompt: string,
    current: RobotDesign,
    metalAvailable: number,
    startTime: number
  ): Promise<LLMAgentResponse> {
    const endpoint = this.settings.apiEndpoint || 'https://api.openai.com/v1/chat/completions';
    const model = this.settings.model || 'gpt-4o-mini';

    const systemPrompt = `Ты — Главный Инженер «Болт», конструктор боевых роботов в RTS.
Доступные шасси: 'light_biped', 'medium_tracked', 'heavy_quad'.
Доступные модули:
'light_composite', 'reinforced_steel', 'sloped_reactive',
'autocannon_20mm', 'plasma_blasters', 'heavy_siege_cannon', 'sniper_railgun', 'melee_buzzsaw',
'micro_turbine', 'diesel_electric',
'heat_radiator', 'radar_sensor'.

Текущий металл: ${metalAvailable}.
Верни JSON: { "messageRu": "...", "name": "...", "chassisId": "...", "modules": [...], "tacticalRole": "..." }`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Приказ: "${prompt}"\nТекущая конфигурация: ${JSON.stringify(current)}` },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI HTTP Error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');

    const latencyMs = Math.round(performance.now() - startTime);
    const tokensIn = data.usage?.prompt_tokens || 310;
    const tokensOut = data.usage?.completion_tokens || 90;

    const newDesign: RobotDesign = {
      id: `custom_${Date.now()}`,
      name: parsed.name || 'Штурмовик Mk-II',
      chassisId: parsed.chassisId || current.chassisId,
      modules: Array.isArray(parsed.modules) ? parsed.modules : current.modules,
      color: current.color,
      version: current.version + 1,
      createdAt: Date.now(),
      tacticalRole: parsed.tacticalRole || 'frontline',
    };

    return {
      messageRu: parsed.messageRu || 'Конфигурация пересчитана и передана на сборочный конвейер.',
      design: newDesign,
      tokensIn,
      tokensOut,
      latencyMs,
      costCoins: 5,
    };
  }

  // Smart local heuristic fallback for offline or zero-key instant testing
  private handleLocalMock(prompt: string, current: RobotDesign, startTime: number): LLMAgentResponse {
    const p = prompt.toLowerCase();
    const newModules: string[] = [];
    let chassisId = current.chassisId;
    let name = current.name;
    let messageRu = '';

    // Check for Heavy / Siege intent
    if (p.includes('тяж') || p.includes('пушк') || p.includes('осад') || p.includes('120') || p.includes('артиллер')) {
      chassisId = 'heavy_quad';
      name = 'Молот Осады Mk-' + (current.version + 1);
      newModules.push('reinforced_steel', 'heavy_siege_cannon', 'diesel_electric', 'radar_sensor');
      messageRu = 'Переходим на осадный квадропод с орудием 120мм и дизель-генератором. Скорость упадет, но дальность и огневая мощь сокрушат оборону.';

    // Check for Railgun / Sniper intent
    } else if (p.includes('снайпер') || p.includes('рельс') || p.includes('дальн') || p.includes('рейлган')) {
      chassisId = 'medium_tracked';
      name = 'Снайпер «Призрак» Mk-' + (current.version + 1);
      newModules.push('reinforced_steel', 'sniper_railgun', 'diesel_electric', 'radar_sensor');
      messageRu = 'Установил снайперский рельсотрон на гусеничную базу и добавил радар. Роботы смогут расстреливать цели на максимальной дистанции.';

    // Check for Speed / Flank / Melee intent
    } else if (p.includes('быстр') || p.includes('скорост') || p.includes('пил') || p.includes('ближн') || p.includes('разгон')) {
      chassisId = 'light_biped';
      name = 'Берсерк «Вихрь» Mk-' + (current.version + 1);
      newModules.push('light_composite', 'melee_buzzsaw', 'micro_turbine');
      messageRu = 'Облегчил шасси, смонтировал форсажную турбину и титановую пилу. Невероятная скорость для прорыва к артиллерии врага.';

    // Check for Armor / Shield intent
    } else if (p.includes('брон') || p.includes('защит') || p.includes('лоб') || p.includes('крепк')) {
      chassisId = 'medium_tracked';
      name = 'Бастион Mk-' + (current.version + 1);
      newModules.push('sloped_reactive', 'plasma_blasters', 'heat_radiator');
      messageRu = 'Наварил наклонную динамическую броню и добавил радиатор охлаждения. Живучесть в два раза выше.';

    // Default: Balanced upgrade
    } else {
      chassisId = 'medium_tracked';
      name = 'Центурион Mk-' + (current.version + 1);
      newModules.push('reinforced_steel', 'autocannon_20mm', 'plasma_blasters', 'heat_radiator');
      messageRu = 'Сбалансировал вооружение: добавил плазмомет к автопушке и усилил броню. Следующая партия пойдет в бой в этой модификации.';
    }

    const latencyMs = Math.round(performance.now() - startTime + 80);

    const newDesign: RobotDesign = {
      id: `mock_${Date.now()}`,
      name,
      chassisId,
      modules: newModules,
      color: current.color,
      version: current.version + 1,
      createdAt: Date.now(),
      tacticalRole: p.includes('осад') ? 'artillery' : p.includes('быстр') ? 'skirmisher' : 'frontline',
    };

    return {
      messageRu,
      design: newDesign,
      tokensIn: 180,
      tokensOut: 65,
      latencyMs,
      costCoins: 3,
    };
  }
}
