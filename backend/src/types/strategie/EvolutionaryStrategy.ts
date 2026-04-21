import config from '../../config.json';
import { AdaptiveStrategy, LearningFeedback } from './AdaptiveStrategy';

interface WeightGenome {
    price: number;
    distance: number;
    reliability: number;
}

/**
 * Evolutionary strategy based on mutation + selection over score weights.
 * Uses 3-dimension genome (price, distance, reliability).
 */
export class EvolutionaryStrategy extends AdaptiveStrategy {
    private readonly evaluationWindow = 4; 

    private mutationScale = 0.28;
    private generation = 0;
    private recentRewards: number[] = [];
    private bestScore = Number.NEGATIVE_INFINITY;
    private bestGenome: WeightGenome;
    private stagnationCounter = 0;

    constructor(seed?: string) {
        super(seed);
        this.jmeno = 'Evolutionary Strategy';
        this.bestGenome = this.captureGenome();
    }

    protected override getAggressionBias(): number {
        return 0.30;
    }

    protected updateWeights(feedback?: LearningFeedback): void {
        this.totalDecisions++;

        if (!feedback) {
            super.updateWeights();
            return;
        }

        const reward = feedback.success
            ? feedback.unitProfit
            : -1;

        this.recentRewards.push(reward);
        if (this.recentRewards.length > this.evaluationWindow) {
            this.recentRewards.shift();
        }

        if (this.totalDecisions % this.evaluationWindow !== 0) return;

        const currentScore =
            this.recentRewards.reduce((s, v) => s + v, 0) /
            Math.max(this.recentRewards.length, 1);

        if (currentScore >= this.bestScore) {
            this.bestScore = currentScore;
            this.bestGenome = this.captureGenome();
            this.mutationScale = Math.max(0.08, this.mutationScale * 0.92);
            this.stagnationCounter = 0;
        } else {
            this.applyGenome(this.bestGenome);
            this.mutationScale = Math.min(0.35, this.mutationScale * 1.12);
            this.stagnationCounter++;
        }

        if (this.stagnationCounter >= 3) {
            const randomGenome: WeightGenome = {
                price: 0.1 + this.seededRng() * 0.6,
                distance: 0.1 + this.seededRng() * 0.4,
                reliability: 0.1 + this.seededRng() * 0.4,
            };
            this.applyGenome(randomGenome);
            this.mutationScale = 0.2;
            this.stagnationCounter = 0;
        }

        this.generation++;
        const mutated = this.mutateGenome(this.bestGenome, this.mutationScale);
        this.applyGenome(mutated);
    }

    public getSupplySpendRatio(): number {
        const minRatio = config.strategie.adaptive.supplySpendRatio.min;
        const maxRatio = config.strategie.adaptive.supplySpendRatio.max;

        const progress = Math.min(this.generation / 10, 1);
        const successRate = this.getOverallSuccessRate();

        const ratio = minRatio + (0.3 * progress + 0.7 * successRate) * (maxRatio - minRatio);
        return Math.max(minRatio, Math.min(maxRatio, ratio));
    }

    private captureGenome(): WeightGenome {
        return {
            price: this.w_cena,
            distance: this.w_vzdalenost,
            reliability: this.w_reliability,
        };
    }

    private applyGenome(genome: WeightGenome): void {
        const price = Math.max(0.05, genome.price);
        const distance = Math.max(0.05, genome.distance);
        const reliability = Math.max(0.05, genome.reliability);

        const sum = price + distance + reliability;
        this.w_cena = price / sum;
        this.w_vzdalenost = distance / sum;
        this.w_reliability = reliability / sum;
    }

    private mutateGenome(source: WeightGenome, scale: number): WeightGenome {
        return {
            price: source.price + this.randomMutation(scale),
            distance: source.distance + this.randomMutation(scale),
            reliability: source.reliability + this.randomMutation(scale),
        };
    }

    private randomMutation(scale: number): number {
        return (this.seededRng() * 2 - 1) * scale;
    }
}
