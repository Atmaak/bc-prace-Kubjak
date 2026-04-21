import config from '../../config.json';
import { AdaptiveStrategy, LearningFeedback } from './AdaptiveStrategy';

/**
 * Reinforcement-learning inspired strategy.
 * Uses TD-learning with eligibility traces on the 3-dimension supplier weights
 * (price, distance, reliability).
 */
export class ReinforcementLearningStrategy extends AdaptiveStrategy {
    private readonly gamma = 0.95;
    private readonly minWeight = 0.05;

    // Per-weight eligibility traces for momentum
    private e_cena = 0.0;
    private e_vzdalenost = 0.0;
    private e_reliability = 0.0;
    private readonly traceDecay = 0.80;

    // Track running average reward for normalisation
    private avgReward = 0.0;
    private rewardCount = 0;

    constructor(seed?: string) {
        super(seed);
        this.jmeno = 'Reinforcement Learning Strategy';
    }

    protected override getAggressionBias(): number {
        return 0.40;
    }

    protected updateWeights(feedback?: LearningFeedback): void {
        this.totalDecisions++;

        if (!feedback) {
            super.updateWeights();
            return;
        }

        // Normalise reward against running mean
        this.rewardCount++;
        const rawReward = feedback.success
            ? feedback.unitProfit
            : -1;
        this.avgReward += (rawReward - this.avgReward) / this.rewardCount;
        const normalizedReward = Math.max(-1, Math.min(1,
            (rawReward - this.avgReward) / (Math.abs(this.avgReward) + 1)
        ));

        // TD target
        const qMax = Math.max(
            this.w_cena, this.w_vzdalenost, this.w_reliability
        );
        const tdTarget = normalizedReward + this.gamma * qMax;

        // Feature signals
        const priceSignal = feedback.unitProfit > 0.15 ? 1.0 : (feedback.unitProfit > -0.05 ? 0.2 : -0.8);
        const distanceSignal = feedback.deliveryTime <= 1 ? 1.0 : (feedback.deliveryTime <= 3 ? 0.3 : -0.5);
        const reliabilitySignal = feedback.success ? 1.0 : -1.0;

        // Update eligibility traces (momentum)
        this.e_cena = this.traceDecay * this.e_cena + priceSignal;
        this.e_vzdalenost = this.traceDecay * this.e_vzdalenost + distanceSignal;
        this.e_reliability = this.traceDecay * this.e_reliability + reliabilitySignal;

        // TD update with eligibility traces
        const lr = this.learningRate;
        this.w_cena += lr * (tdTarget * this.e_cena - this.w_cena);
        this.w_vzdalenost += lr * (tdTarget * this.e_vzdalenost - this.w_vzdalenost);
        this.w_reliability += lr * (tdTarget * this.e_reliability - this.w_reliability);

        // Clamp negatives before normalisation
        this.w_cena = Math.max(this.minWeight, this.w_cena);
        this.w_vzdalenost = Math.max(this.minWeight, this.w_vzdalenost);
        this.w_reliability = Math.max(this.minWeight, this.w_reliability);

        this.normalizeSupplierWeights(this.minWeight);
    }

    public getSupplySpendRatio(): number {
        const successRate = this.getOverallSuccessRate();
        const rewardPerDecision =
            this.cumulativeReward / Math.max(this.totalDecisions, 1);

        const rewardBoost = Math.max(-0.20, Math.min(0.20,
            rewardPerDecision / (config.strategie.adaptive.rewardBase * 5)
        ));

        const minRatio = config.strategie.adaptive.supplySpendRatio.min;
        const maxRatio = config.strategie.adaptive.supplySpendRatio.max;

        const baseRatio = maxRatio - (1 - successRate) * (maxRatio - minRatio) * 0.3;
        const ratio = baseRatio + rewardBoost;

        return Math.max(minRatio, Math.min(maxRatio, ratio));
    }
}
