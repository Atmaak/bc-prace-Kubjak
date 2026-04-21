import { Strategie } from '../types/strategie';
import { VyvazenaStrategie } from '../types/strategie/VyvazenaStrategie';
import { AggressiveGrowthStrategy } from '../types/strategie/AggressiveGrowthStrategy';
import { ConservativeSavingsStrategy } from '../types/strategie/ConservativeSavingsStrategy';
import { MarketLeaderStrategy } from '../types/strategie/MarketLeaderStrategy';
import { AdaptiveStrategy } from '../types/strategie/AdaptiveStrategy';
import { ReinforcementLearningStrategy } from '../types/strategie/ReinforcementLearningStrategy';
import { EvolutionaryStrategy } from '../types/strategie/EvolutionaryStrategy';
import { loadAdaptiveWeights } from './adaptiveStrategyLearning';

export type StrategyVariant =
  | 'BALANCED'
  | 'AGGRESSIVE'
  | 'CONSERVATIVE'
  | 'MARKET_LEADER'
  | 'DOMINANT'
  | 'ADAPTIVE'
  | 'RL'
  | 'EVOLUTIONARY';

type AdaptiveTrackedVariant = Extract<StrategyVariant, 'ADAPTIVE' | 'RL' | 'EVOLUTIONARY'>;

// Global registry for adaptive strategies to track learning across instances
const adaptiveInstances: Map<string, { strategy: AdaptiveStrategy; variant: AdaptiveTrackedVariant }> = new Map();

export class StrategyFactory {
  private static readonly strategies: Record<StrategyVariant, (seed?: string) => Strategie> = {
    BALANCED: () => new VyvazenaStrategie(),
    AGGRESSIVE: () => new AggressiveGrowthStrategy(),
    CONSERVATIVE: () => new ConservativeSavingsStrategy(),
    MARKET_LEADER: () => new MarketLeaderStrategy(),
    // Backward-compatible alias used by older scenarios/configs.
    DOMINANT: () => new MarketLeaderStrategy(),
    ADAPTIVE: (seed?: string) => {
      const strategy = new AdaptiveStrategy(seed);
      // Load previous learning if available
      const savedWeights = loadAdaptiveWeights('adaptive');
      if (savedWeights) {
        strategy.importWeights(savedWeights, 0.3); // 30% boost from previous learning
        console.log(`[Adaptive Load] ADAPTIVE weights loaded: price=${savedWeights.w_cena.toFixed(3)}, distance=${savedWeights.w_vzdalenost.toFixed(3)}, reliability=${savedWeights.w_reliability.toFixed(3)}, decisions=${savedWeights.totalDecisions}`);
      }
      return strategy;
    },
    RL: (seed?: string) => {
      const strategy = new ReinforcementLearningStrategy(seed);
      const savedWeights = loadAdaptiveWeights('rl');
      if (savedWeights) {
        strategy.importWeights(savedWeights, 0.3);
        console.log(`[Adaptive Load] RL weights loaded: price=${savedWeights.w_cena.toFixed(3)}, distance=${savedWeights.w_vzdalenost.toFixed(3)}, reliability=${savedWeights.w_reliability.toFixed(3)}, decisions=${savedWeights.totalDecisions}`);
      }
      return strategy;
    },
    EVOLUTIONARY: (seed?: string) => {
      const strategy = new EvolutionaryStrategy(seed);
      const savedWeights = loadAdaptiveWeights('evolutionary');
      if (savedWeights) {
        strategy.importWeights(savedWeights, 0.3);
        console.log(`[Adaptive Load] EVOLUTIONARY weights loaded: price=${savedWeights.w_cena.toFixed(3)}, distance=${savedWeights.w_vzdalenost.toFixed(3)}, reliability=${savedWeights.w_reliability.toFixed(3)}, decisions=${savedWeights.totalDecisions}`);
      }
      return strategy;
    },
  };

  static createStrategy(variant: StrategyVariant, instanceId?: string, seed?: string): Strategie {
    const factory = this.strategies[variant];
    if (!factory) {
      throw new Error(`Unknown strategy variant: ${variant}`);
    }

    const strategy = factory(seed);

    // Track adaptive instances for feedback
    if ((variant === 'ADAPTIVE' || variant === 'RL' || variant === 'EVOLUTIONARY') && instanceId && strategy instanceof AdaptiveStrategy) {
      adaptiveInstances.set(instanceId, { strategy, variant });
    }

    return strategy;
  }

  static getAvailableStrategies(): StrategyVariant[] {
    return Object.keys(this.strategies) as StrategyVariant[];
  }

  static getAdaptiveInstance(instanceId: string): AdaptiveStrategy | undefined {
    return adaptiveInstances.get(instanceId)?.strategy;
  }

  static getAllAdaptiveInstances(): AdaptiveStrategy[] {
    return Array.from(adaptiveInstances.values(), value => value.strategy);
  }

  static getAllAdaptiveInstancesWithMetadata(): Array<{
    instanceId: string;
    variant: AdaptiveTrackedVariant;
    strategy: AdaptiveStrategy;
  }> {
    return Array.from(adaptiveInstances.entries(), ([instanceId, value]) => ({
      instanceId,
      variant: value.variant,
      strategy: value.strategy,
    }));
  }
}

export class CompanyConfig {
  constructor(
    public id: number | string,
    public name: string,
    public strategyVariant: StrategyVariant,
    public initialFinance: number = 100000
  ) {}
}


