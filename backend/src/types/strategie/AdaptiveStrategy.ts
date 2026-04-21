import { Strategie } from '../strategie';
import { Firma } from '../firma';
import { Dodavatel } from '../dodavatel';
import { TypSuroviny } from '../typSuroviny';
import { getGeoDistance } from '../../utils/distance';
import { SimulationEngine } from '../../simulation';
import { createRng } from '../../utils/rng';
import config from '../../config.json';

export interface SupplierPerformance {
    supplierId: number;
    successCount: number;
    failureCount: number;
    totalCostPaid: number;
    totalQuantity: number;
    avgDeliveryTime: number;
    lastUsedTick: number;
}

export interface LearningFeedback {
    supplierId: number;
    success: boolean;
    unitProfit: number;
    quantity: number;
    deliveryTime: number;
}

/**
 * Adaptive Learning Strategy (v2)
 *
 * Self-learning strategy that improves supplier selection over time.
 * Key changes vs v1:
 *  - Boost phase: first N ticks run at high fixed production/spend (no guards)
 *  - Single-gate expansion (same as Balanced/Aggressive)
 *  - EMA-based weight transitions (no oscillation)
 *  - Simplified 3-dimension supplier scoring (price, distance, reliability)
 *  - Weakened financial guards (only light dampening, never hard-block)
 */
export class AdaptiveStrategy implements Strategie {
    protected jmeno = "Adaptive Learning Strategy";

    protected performance: Map<number, SupplierPerformance> = new Map();
    protected learningRate: number = config.strategie.adaptive.learningRate;
    protected w_cena: number = config.strategie.adaptive.initialWeights.price;
    protected w_vzdalenost: number = config.strategie.adaptive.initialWeights.distance;
    protected w_reliability: number = config.strategie.adaptive.initialWeights.reliability;

    protected totalDecisions: number = 0;
    protected cumulativeReward: number = 0;

    protected growthAggression: number = 1.0;
    protected expansionLearningReward: number = 0;
    protected kpiCompetitiveReward: number = 0;

    private lastGrowthCheckpointTick: number = -1;
    private lastGrowthInfrastructureScore: number = 0;
    private lastGrowthProfit: number = 0;
    private lastWeightRefreshTick: number = -1;

    private financialRiskSignal: number = 0;

    // Track the first tick seen so we know when boost phase ends
    private firstTickSeen: number = -1;

    protected seed: string;
    protected seededRng: () => number;

    /**
     * Subclasses can bias how aggressively they pursue growth/profit.
     * Positive values increase production, spending and expansion cadence.
     */
    protected getAggressionBias(): number {
        return 0;
    }

    constructor(seed?: string) {
        this.seed = seed ?? 'DEFAULT_ADAPTIVE_SEED';
        this.seededRng = createRng(this.seed);
        this.initializePerformance();
    }

    private initializePerformance(): void {
        const supplierCount = config.suppliers.koksCount + config.suppliers.rudaCount;
        for (let i = 1; i <= supplierCount; i++) {
            this.performance.set(i, {
                supplierId: i,
                successCount: config.strategie.adaptive.initialSuccessCount,
                failureCount: 0,
                totalCostPaid: 0,
                totalQuantity: 0,
                avgDeliveryTime: 0,
                lastUsedTick: 0
            });
        }
    }

    /** Is the strategy still in boosted "cold start" phase? */
    protected isBoostPhase(tick: number): boolean {
        if (this.firstTickSeen < 0) return true; // haven't started yet
        return (tick - this.firstTickSeen) < config.strategie.adaptive.boostPhaseTicks;
    }

    public recordSupplierFeedback(
        supplierId: number,
        success: boolean,
        cost: number,
        quantity: number,
        deliveryTime: number
    ): void {
        const perf = this.performance.get(supplierId);
        if (!perf) return;

        const referenceUnitCost = (config.dodavatel.pocatecniCenaKoksu + config.dodavatel.pocatecniCenaRudy) / 2;
        const unitCost = quantity > 0 ? (cost / quantity) : referenceUnitCost;
        const normalizedUnitProfit = this.clamp(
            (referenceUnitCost - unitCost) / Math.max(referenceUnitCost, 1),
            -1,
            1
        );

        if (success && quantity > 0) {
            perf.successCount++;
            this.cumulativeReward += normalizedUnitProfit * config.strategie.adaptive.rewardBase;
        } else {
            perf.failureCount++;
            this.cumulativeReward -= config.strategie.adaptive.failurePenalty;
        }

        perf.totalCostPaid += cost;
        perf.totalQuantity += quantity;
        perf.avgDeliveryTime = (perf.avgDeliveryTime + deliveryTime) / 2;
        perf.lastUsedTick = Math.max(perf.lastUsedTick, deliveryTime);

        this.updateWeights({
            supplierId,
            success,
            unitProfit: normalizedUnitProfit,
            quantity,
            deliveryTime,
        });
    }

    /**
     * EMA-based weight update — smooth transitions, no oscillation.
     */
    protected updateWeights(_feedback?: LearningFeedback): void {
        this.totalDecisions++;

        const dataConfidence = Math.min(
            this.totalDecisions / (config.strategie.adaptive.decisionConfidenceHorizon * 0.5),
            1.0
        );
        const emaDecay = config.strategie.adaptive.weightEmaDecay;

        // Determine target weights based on ROI
        const avgROI = this.cumulativeReward / Math.max(this.totalDecisions, 1);
        let targetPrice: number;
        let targetDistance: number;
        let targetReliability: number;

        if (avgROI > config.strategie.adaptive.roiThresholds.good) {
            targetPrice = config.strategie.adaptive.performanceWeights.good.price;
            targetDistance = config.strategie.adaptive.performanceWeights.good.distance;
            targetReliability = config.strategie.adaptive.performanceWeights.good.reliability;
        } else if (avgROI < config.strategie.adaptive.roiThresholds.poor) {
            targetPrice = config.strategie.adaptive.performanceWeights.poor.price;
            targetDistance = config.strategie.adaptive.performanceWeights.poor.distance;
            targetReliability = config.strategie.adaptive.performanceWeights.poor.reliability;
        } else {
            targetPrice = config.strategie.adaptive.performanceWeights.neutral.price;
            targetDistance = config.strategie.adaptive.performanceWeights.neutral.distance;
            targetReliability = config.strategie.adaptive.performanceWeights.neutral.reliability;
        }

        // Apply EMA (smooth transition) weighted by data confidence
        const effectiveDecay = emaDecay * dataConfidence;
        this.w_cena = this.w_cena * (1 - effectiveDecay) + targetPrice * effectiveDecay;
        this.w_vzdalenost = this.w_vzdalenost * (1 - effectiveDecay) + targetDistance * effectiveDecay;
        this.w_reliability = this.w_reliability * (1 - effectiveDecay) + targetReliability * effectiveDecay;

        this.normalizeSupplierWeights();
    }

    protected normalizeSupplierWeights(minWeight: number = 0.05): void {
        this.w_cena = Math.max(minWeight, this.w_cena);
        this.w_vzdalenost = Math.max(minWeight, this.w_vzdalenost);
        this.w_reliability = Math.max(minWeight, this.w_reliability);

        const sum = this.w_cena + this.w_vzdalenost + this.w_reliability;
        if (sum <= 0) return;

        this.w_cena /= sum;
        this.w_vzdalenost /= sum;
        this.w_reliability /= sum;
    }

    /**
     * Weakened financial risk signal — only mild dampening, never hard-blocks.
     */
    private updateFinancialRiskSignal(firma: Firma): void {
        const liquidityCoverage = this.clamp(firma.KPI.likviditniKrytiProvozu, -1, 3);
        const unmetDemand = this.clamp(firma.KPI.miraNesplnenePoptavky, 0, 1);
        const negativeFinanceSignal = firma.finance < 0 ? 1 : 0;

        const liquidityStress = liquidityCoverage >= 1
            ? 0
            : this.clamp(1 - liquidityCoverage, 0, 1);

        // Reduced sensitivity (was 0.4 / 0.15 / 0.25, now 0.2 / 0.1 / 0.15)
        this.financialRiskSignal = this.clamp(
            liquidityStress * 0.2 + unmetDemand * 0.1 + negativeFinanceSignal * 0.15,
            0,
            1
        );
    }

    public vykonejRozhodnuti(firma: Firma, tick: number, sim?: SimulationEngine): void {
        if (sim) {
            const logger = sim.getLogger();

            // Track first tick for boost phase calculation
            if (this.firstTickSeen < 0) {
                this.firstTickSeen = tick;
            }

            const boostActive = this.isBoostPhase(tick);
            const effectiveAggression = this.clamp(this.growthAggression + this.getAggressionBias(), 0.5, 2.0);

            this.updateGrowthLearning(firma, tick, sim);

            // Skip financial guard during boost phase
            if (!boostActive) {
                this.updateFinancialRiskSignal(firma);
            } else {
                this.financialRiskSignal = 0;
            }

            const maxCapacity = firma.getMaxProductionCapacity();
            const successRate = this.getOverallSuccessRate();

            // --- Production rate ---
            let productionRate: number;
            if (boostActive) {
                // Boost phase: fixed high rate, close to Aggressive
                productionRate = config.strategie.adaptive.boostProductionRate;
            } else {
                // Learning phase: adjust based on success
                productionRate = config.strategie.adaptive.productionRates.default;
                if (successRate > config.strategie.adaptive.successThresholds.high) {
                    productionRate = config.strategie.adaptive.productionRates.highSuccess;
                } else if (successRate < config.strategie.adaptive.successThresholds.low) {
                    productionRate = config.strategie.adaptive.productionRates.lowSuccess;
                }

                // Light dampening from financial risk (never below 0.65)
                const productionGuard =
                    1 - (this.financialRiskSignal * config.strategie.adaptive.financialGuards.productionSlowdownAtMaxRisk);
                const aggressionProductionMultiplier = this.clamp(
                    0.9 + (effectiveAggression - 1) * 0.5,
                    0.75,
                    1.3
                );
                productionRate = this.clamp(
                    productionRate * productionGuard * aggressionProductionMultiplier,
                    0.75,
                    config.strategie.adaptive.productionRates.highSuccess
                );
            }

            const desiredProduction = Math.floor(maxCapacity * productionRate);

            // --- Expansion: strict modulo gate (prevents cash drain by enforcing exact periodic checks) ---
            const expandIntervalTicks = Math.max(
                config.strategie.adaptive.expandInterval.minTicks,
                Math.floor(
                    config.strategie.adaptive.expandInterval.baseTicks -
                    effectiveAggression * config.strategie.adaptive.expandInterval.aggressionScale
                )
            );

            if (firma.shouldExpand() && tick % expandIntervalTicks === 0) {
                firma.expandProduction(tick);
                firma.expandStorage(tick);
                // ZMĚNA: Dvoukolová expanze — pokud stále shouldExpand, expandovat znovu
                if (firma.shouldExpand()) {
                    firma.expandProduction(tick);
                    firma.expandStorage(tick);
                }
            }

            firma.buySuppliesDynamically(tick);

            const produced = firma.produce(desiredProduction, tick);
            if (produced > 0) {
                firma.sellProduct(produced, TypSuroviny.OCEL, tick);
            }

            logger.logEvent(
                logger.createEvent(tick, 'STRATEGY_DECISION_MADE', firma.id, {
                    strategyName: this.jmeno,
                    decision: 'ADAPTIVE_PRODUCTION',
                    productionRate,
                    desiredProduction,
                    actuallyProduced: produced,
                    boostPhase: boostActive,
                    rationale: `Adaptive${boostActive ? ' (BOOST)' : ''} - SuccessRate: ${(successRate * 100).toFixed(1)}%, Aggression: ${this.growthAggression.toFixed(2)}, Production: ${(productionRate * 100).toFixed(0)}%`,
                    totalDecisions: this.totalDecisions,
                    cumulativeReward: this.cumulativeReward,
                    growthAggression: this.growthAggression,
                    expansionLearningReward: this.expansionLearningReward,
                    kpiCompetitiveReward: this.kpiCompetitiveReward,
                    financialRiskSignal: this.financialRiskSignal,
                    supplierWeights: {
                        price: this.w_cena,
                        distance: this.w_vzdalenost,
                        reliability: this.w_reliability
                    }
                }, { companyId: firma.id, strategyId: this.jmeno })
            );
        }
    }

    private updateGrowthLearning(firma: Firma, tick: number, sim: SimulationEngine): void {
        const checkpointInterval = 12; 
        const weightRefreshInterval = config.strategie.adaptive.weightRefreshInterval;
        const infrastructureScore = this.calculateInfrastructureScore(firma);
        const netProfit = firma.KPI.cistyZisk;

        if (this.lastWeightRefreshTick < 0 || tick - this.lastWeightRefreshTick >= weightRefreshInterval) {
            this.updateWeights();
            this.lastWeightRefreshTick = tick;
        }

        if (this.lastGrowthCheckpointTick < 0) {
            this.lastGrowthCheckpointTick = tick;
            this.lastGrowthInfrastructureScore = infrastructureScore;
            this.lastGrowthProfit = netProfit;
            return;
        }

        if (tick - this.lastGrowthCheckpointTick < checkpointInterval) return;

        const infrastructureDelta = infrastructureScore - this.lastGrowthInfrastructureScore;
        const profitDelta = netProfit - this.lastGrowthProfit;
        const roiSignal = this.clamp(firma.KPI.ROI, -1, 1);

        const growthReward = this.clamp(
            infrastructureDelta * 0.25 + (profitDelta / 1_000_000) * 0.2 + roiSignal * 0.4,
            -1,
            1
        );

        this.expansionLearningReward += growthReward;

        this.growthAggression = this.clamp(
            this.growthAggression + this.learningRate * growthReward * 0.75,
            0.5,
            2.0
        );

        const kpiReward = this.calculateCompetitiveKpiReward(firma, sim);
        this.kpiCompetitiveReward += kpiReward;
        this.cumulativeReward += kpiReward * (config.strategie.adaptive.rewardBase * 0.35);
        this.growthAggression = this.clamp(
            this.growthAggression + this.learningRate * kpiReward * 0.50,
            0.5,
            2.0
        );

        this.lastGrowthCheckpointTick = tick;
        this.lastGrowthInfrastructureScore = infrastructureScore;
        this.lastGrowthProfit = netProfit;
    }

    private calculateCompetitiveKpiReward(firma: Firma, sim: SimulationEngine): number {
        const companies = sim.getAgents().filter((agent): agent is Firma => agent instanceof Firma);
        if (companies.length <= 1) return 0;

        const toCompositeScore = (company: Firma): number => {
            const roiScore = this.clamp(company.KPI.ROI, -1, 1);
            const profitScore = this.clamp(company.KPI.cistyZisk / 2_000_000, -1, 1);
            const productionUtilization = this.clamp(company.KPI.miraVyuzitiVyrobniKapacity, 0, 1);
            const storageUtilization = this.clamp(company.KPI.miraVyuzitiSkladovaciJednotky, 0, 1);
            const unmetDemandPenalty = this.clamp(company.KPI.miraNesplnenePoptavky, 0, 1);
            const operatingMarginScore = this.clamp(company.KPI.provozniMarze, -1, 1);
            const orderFulfillmentScore = this.clamp(company.KPI.uspesnostPlneniObjednavek, 0, 1);
            const liquidityCoverageScore = this.clamp(company.KPI.likviditniKrytiProvozu / 2, 0, 1);
            const costIntensityPenalty = this.clamp(company.KPI.nakladovostTrzeb / 2, 0, 1);

            // ZMĚNA: Přeladěné váhy kompozitního skóre — důraz na ROI a zisk
            return (
                roiScore * 0.28 +          // ZMĚNA: 0.22 → 0.28 (hlavní KPI posílena)
                profitScore * 0.22 +        // ZMĚNA: 0.20 → 0.22
                operatingMarginScore * 0.18 +
                orderFulfillmentScore * 0.12 + // ZMĚNA: 0.14 → 0.12
                productionUtilization * 0.10 +
                storageUtilization * 0.04 +  // ZMĚNA: 0.06 → 0.04
                liquidityCoverageScore * 0.06 -
                unmetDemandPenalty * 0.12 -
                costIntensityPenalty * 0.12
            );
        };

        const ownScore = toCompositeScore(firma);
        const competitors = companies.filter(c => c.id !== firma.id);
        if (competitors.length === 0) return 0;

        const competitorsAverage =
            competitors.reduce((sum, c) => sum + toCompositeScore(c), 0) / competitors.length;

        return this.clamp((ownScore - competitorsAverage) * 0.9, -1, 1);
    }

    private calculateInfrastructureScore(firma: Firma): number {
        let lineCount = 0;
        let storageCount = 0;
        firma.budovy.forEach(b => {
            lineCount += b.linky.length;
            storageCount += b.skladovaciJednotky.length;
        });
        return firma.budovy.length * 3 + lineCount * 2 + storageCount;
    }

    protected clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }

    protected getOverallSuccessRate(): number {
        let totalSuccess = 0;
        let totalAttempts = 0;
        this.performance.forEach(perf => {
            totalSuccess += perf.successCount;
            totalAttempts += perf.successCount + perf.failureCount;
        });
        return totalAttempts === 0
            ? config.strategie.adaptive.defaultSuccessRate
            : totalSuccess / totalAttempts;
    }

    /**
     * Supply spend ratio — high floor (0.30), boost phase uses fixed 0.40,
     * learned phase applies only light dampening.
     */
    public getSupplySpendRatio(): number {
        const successRate = this.getOverallSuccessRate();
        const minRatio = config.strategie.adaptive.supplySpendRatio.min;
        const maxRatio = config.strategie.adaptive.supplySpendRatio.max;

        // During boost phase, use fixed high ratio
        if (this.firstTickSeen < 0) {
            return config.strategie.adaptive.boostSupplySpendRatio;
        }

        // Base ratio: start near max, scale down slightly based on success
        const baseRatio = maxRatio - (1 - successRate) * (maxRatio - minRatio) * 0.3;

        // Growth learning influences procurement aggressiveness.
        const effectiveAggression = this.clamp(this.growthAggression + this.getAggressionBias(), 0.5, 2.0);
        const growthAggressionOffset = (effectiveAggression - 1) * 0.15;

        // Only light dampening from financial risk
        const guardedRatio =
            (baseRatio + growthAggressionOffset) * (1 - this.financialRiskSignal *
                config.strategie.adaptive.financialGuards.spendReductionAtMaxRisk);

        return this.clamp(guardedRatio, minRatio, maxRatio);
    }
    public zjistiDodavatele(
        firma: Firma,
        dodavatele: Dodavatel[],
        typSuroviny: TypSuroviny
    ): Dodavatel | null {
        const kandidati = dodavatele.filter(d => d.typSuroviny === typSuroviny);
        if (kandidati.length === 0) return null;

        const scored = kandidati.map(d => {
            const perf = this.performance.get(d.id) ?? {
                supplierId: d.id,
                successCount: 1,
                failureCount: 0,
                totalCostPaid: 0,
                totalQuantity: 0,
                avgDeliveryTime: 0,
                lastUsedTick: 0
            };

            const successRate =
                perf.successCount / (perf.successCount + perf.failureCount);
            
            const currentCostPerUnit = d.cena;

            return {
                dodavatel: d,
                vzdalenost: getGeoDistance(d.poloha, firma.poloha),
                successRate,
                avgCostPerUnit: currentCostPerUnit,
                skore: 0
            };
        });

        const maxCena = Math.max(...scored.map(h => h.avgCostPerUnit));
        const minCena = Math.min(...scored.map(h => h.avgCostPerUnit));
        const maxVzd = Math.max(...scored.map(h => h.vzdalenost));
        const minVzd = Math.min(...scored.map(h => h.vzdalenost));

        const rCena = maxCena - minCena || 1;
        const rVzd = maxVzd - minVzd || 1;

        scored.forEach(h => {
            const normCena = 1 - (h.avgCostPerUnit - minCena) / rCena;
            const normVzd = 1 - (h.vzdalenost - minVzd) / rVzd;
            const normReliability = h.successRate;

            h.skore =
                normCena * this.w_cena +
                normVzd * this.w_vzdalenost +
                normReliability * this.w_reliability;
        });

        scored.sort((a, b) => b.skore - a.skore);
        return scored[0]?.dodavatel ?? null;
    }

    public getPerformanceMetrics() {
        return {
            totalDecisions: this.totalDecisions,
            cumulativeReward: this.cumulativeReward,
            overallSuccessRate: this.getOverallSuccessRate(),
            weights: {
                price: this.w_cena,
                distance: this.w_vzdalenost,
                reliability: this.w_reliability
            },
            growth: {
                aggression: this.growthAggression,
                reward: this.expansionLearningReward,
                competitiveReward: this.kpiCompetitiveReward
            },
            financialRiskSignal: this.financialRiskSignal,
            performanceData: Array.from(this.performance.values())
        };
    }

    public exportWeights() {
        return {
            timestamp: new Date().toISOString(),
            w_cena: this.w_cena,
            w_vzdalenost: this.w_vzdalenost,
            w_reliability: this.w_reliability,
            totalDecisions: this.totalDecisions,
            cumulativeReward: this.cumulativeReward,
            growthAggression: this.growthAggression,
            expansionLearningReward: this.expansionLearningReward,
            kpiCompetitiveReward: this.kpiCompetitiveReward,
            performance: Array.from(this.performance.entries()).map(([id, perf]) => ({ id, ...perf }))
        };
    }

    public importWeights(savedState: {
        w_cena: number;
        w_vzdalenost: number;
        w_reliability: number;
        w_deliveryTime?: number;
        w_availability?: number;
        totalDecisions: number;
        cumulativeReward: number;
        growthAggression?: number;
        expansionLearningReward?: number;
        kpiCompetitiveReward?: number;
        performance: Array<{ id: number } & SupplierPerformance>;
    }, boostFactor: number = 0.3): void {
        const safeBoost = this.clamp(boostFactor, 0, 1);
        const initial = config.strategie.adaptive.initialWeights;

        const sanitizeWeight = (value: number | undefined, fallback: number): number => {
            if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
            return value > 0 ? value : fallback;
        };

        const savedPrice = sanitizeWeight(savedState.w_cena, initial.price);
        const savedDistance = sanitizeWeight(savedState.w_vzdalenost, initial.distance);
        const savedReliability = sanitizeWeight(savedState.w_reliability, initial.reliability);

        this.w_cena = initial.price * (1 - safeBoost) + savedPrice * safeBoost;
        this.w_vzdalenost = initial.distance * (1 - safeBoost) + savedDistance * safeBoost;
        this.w_reliability = initial.reliability * (1 - safeBoost) + savedReliability * safeBoost;

        this.normalizeSupplierWeights();

        if (Array.isArray(savedState.performance)) {
            savedState.performance.forEach(savedPerf => {
                const currentPerf = this.performance.get(savedPerf.id);
                if (currentPerf) {
                    currentPerf.totalCostPaid = savedPerf.totalCostPaid;
                    currentPerf.totalQuantity = savedPerf.totalQuantity;
                    currentPerf.avgDeliveryTime = savedPerf.avgDeliveryTime;
                    currentPerf.successCount = Math.max(
                        config.strategie.adaptive.initialSuccessCount,
                        Math.floor(savedPerf.successCount * (1 - safeBoost))
                    );
                    currentPerf.failureCount = Math.floor(savedPerf.failureCount * (1 - safeBoost));
                }
            });
        }

        this.totalDecisions = Math.floor(savedState.totalDecisions * safeBoost);
        this.cumulativeReward = savedState.cumulativeReward * safeBoost;

        const savedGrowthAggression = typeof savedState.growthAggression === 'number'
            ? savedState.growthAggression : 1.0;
        const savedExpansionReward = typeof savedState.expansionLearningReward === 'number'
            ? savedState.expansionLearningReward : 0;
        const savedKpiCompetitiveReward = typeof savedState.kpiCompetitiveReward === 'number'
            ? savedState.kpiCompetitiveReward : 0;

        this.growthAggression = this.clamp(
            1.0 * (1 - safeBoost) + savedGrowthAggression * safeBoost,
            0.5,
            2.0
        );
        this.expansionLearningReward = savedExpansionReward * safeBoost;
        this.kpiCompetitiveReward = savedKpiCompetitiveReward * safeBoost;
        this.financialRiskSignal = 0;
        this.lastWeightRefreshTick = -1;
    }
}
