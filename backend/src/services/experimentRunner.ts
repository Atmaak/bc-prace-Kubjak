import fs from 'fs';
import path from 'path';
import config from '../config.json';
import { SimulationEngine } from '../simulation';
import { Region } from '../types/region';
import { Velikost } from '../types/velikost';
import { Firma } from '../types/firma';
import type { KPI } from '../types/kpi';
import { summarize, type NumericSummary } from './statistics';
import { StrategyFactory } from '../utils/strategyFactory';
import { AdaptiveStrategy } from '../types/strategie/AdaptiveStrategy';
import { saveAdaptiveWeights } from '../utils/adaptiveStrategyLearning';

const EXPERIMENTS_DIR = path.resolve(process.cwd(), 'simulation-history', 'experiments');

const LOWER_IS_BETTER_METRICS: Array<keyof KPI> = [
    'miraNesplnenePoptavky',
    'prumernaDobaCekaniSurovin',
    'nakladovostTrzeb',
    'spotrebaEnergie'
];

const AI_STRATEGY_VARIANTS = new Set(['ADAPTIVE', 'RL', 'EVOLUTIONARY']);
const STATIC_STRATEGY_VARIANTS = new Set([
    'BALANCED',
    'AGGRESSIVE',
    'CONSERVATIVE',
    'MARKET_LEADER',
    'DOMINANT'
]);

export type ExperimentRunnerConfig = {
    runsPerStrategy?: number;
    seedPrefix?: string;
    tickCount?: number;
    adaptiveCarryoverLearning?: boolean;
};

export type StrategyMetricResult = NumericSummary & {
    strategyVariant: string;
    rank: number;
    values: number[];
};

export type ExperimentMetricResult = {
    metric: keyof KPI;
    lowerIsBetter: boolean;
    strategies: StrategyMetricResult[];
};

export type ExperimentResult = {
    experimentId: string;
    generatedAt: string;
    config: {
        runsPerStrategy: number;
        tickCount: number;
        seedPrefix: string;
        adaptiveCarryoverLearning: boolean;
    };
    seeds: string[];
    metrics: ExperimentMetricResult[];
    perRun: Array<{
        seed: string;
        tickCount: number;
        companies: Array<{
            companyId: number;
            companyName: string;
            strategyVariant: string;
            kpi: KPI;
        }>;
    }>;
    aiVsStatic: {
        evaluatedMetrics: number;
        aiWins: number;
        staticWins: number;
        ties: number;
        aiWinRate: number;
        metricOutcomes: Array<{
            metric: keyof KPI;
            lowerIsBetter: boolean;
            winner: 'AI' | 'STATIC' | 'TIE';
            aiBestStrategy: string;
            aiBestMean: number;
            staticBestStrategy: string;
            staticBestMean: number;
        }>;
    };
    objectiveSummary: {
        objectiveMetric: keyof KPI;
        winnerStrategy: string;
        winnerGroup: 'AI' | 'STATIC' | 'UNKNOWN';
        winnerMean: number;
    };
    outputPath: string;
};

type StrategyScores = Record<string, Record<keyof KPI, number[]>>;

const KPI_KEYS: Array<keyof KPI> = [
    'ROI',
    'cistyZisk',
    'celkovaInvestice',
    'financniRezerva',
    'likviditniKrytiProvozu',
    'miraVyuzitiVyrobniKapacity',
    'miraVyuzitiSkladovaciJednotky',
    'spotrebaEnergie',
    'miraNesplnenePoptavky',
    'prumernaDobaCekaniSurovin',
    'provozniMarze',
    'nakladovostTrzeb',
    'uspesnostPlneniObjednavek'
];

function ensureExperimentsDir(): void {
    if (!fs.existsSync(EXPERIMENTS_DIR)) {
        fs.mkdirSync(EXPERIMENTS_DIR, { recursive: true });
    }
}

function buildRegion(): Region {
    return new Region(
        config.region.id,
        config.region.nazev,
        new Velikost(config.region.velikost.x, config.region.velikost.y),
        config.region.stred,
    );
}

function createEmptyKpiScoreMap(): Record<keyof KPI, number[]> {
    return {
        ROI: [],
        cistyZisk: [],
        celkovaInvestice: [],
        financniRezerva: [],
        likviditniKrytiProvozu: [],
        miraVyuzitiVyrobniKapacity: [],
        miraVyuzitiSkladovaciJednotky: [],
        spotrebaEnergie: [],
        miraNesplnenePoptavky: [],
        prumernaDobaCekaniSurovin: [],
        provozniMarze: [],
        nakladovostTrzeb: [],
        uspesnostPlneniObjednavek: []
    };
}

function initializeStrategyScores(companies: Firma[]): StrategyScores {
    const scores: StrategyScores = {};

    companies.forEach((company) => {
        const strategyVariant = company.strategyVariant || 'UNKNOWN';
        if (!scores[strategyVariant]) {
            scores[strategyVariant] = createEmptyKpiScoreMap();
        }
    });

    return scores;
}

function runSingleExperiment(seed: string, tickCount: number) {
    const region = buildRegion();
    const simulation = new SimulationEngine(region, seed, undefined, false);

    for (let tick = 0; tick < tickCount; tick++) {
        simulation.step();
    }

    const companies = simulation
        .getAgents()
        .filter((agent): agent is Firma => agent instanceof Firma);

    return {
        tickCount,
        companies,
    };
}

function persistAdaptiveLearningSnapshot(): void {
    const adaptiveInstances = StrategyFactory.getAllAdaptiveInstancesWithMetadata();
    adaptiveInstances.forEach(({ variant, strategy }) => {
        if (!(strategy instanceof AdaptiveStrategy)) {
            return;
        }

        const persistenceKey = variant === 'RL'
            ? 'rl'
            : variant === 'EVOLUTIONARY'
                ? 'evolutionary'
                : 'adaptive';

        saveAdaptiveWeights(strategy.exportWeights(), persistenceKey);
    });
}

function rankStrategies(metric: keyof KPI, valuesByStrategy: Record<string, number[]>): StrategyMetricResult[] {
    const lowerIsBetter = LOWER_IS_BETTER_METRICS.includes(metric);

    const ranked = Object.entries(valuesByStrategy)
        .map(([strategyVariant, values]) => {
            const summary = summarize(values);
            return {
                strategyVariant,
                values,
                ...summary,
                rank: 0
            };
        })
        .sort((a, b) => {
            if (lowerIsBetter) {
                return a.mean - b.mean;
            }
            return b.mean - a.mean;
        })
        .map((item, index) => ({
            ...item,
            rank: index + 1
        }));

    return ranked;
}

function resolveAiVsStaticWinner(params: {
    lowerIsBetter: boolean;
    aiMean: number;
    staticMean: number;
}): 'AI' | 'STATIC' | 'TIE' {
    const { lowerIsBetter, aiMean, staticMean } = params;
    const epsilon = 1e-9;
    if (Math.abs(aiMean - staticMean) <= epsilon) {
        return 'TIE';
    }

    if (lowerIsBetter) {
        return aiMean < staticMean ? 'AI' : 'STATIC';
    }

    return aiMean > staticMean ? 'AI' : 'STATIC';
}

function buildAiVsStaticSummary(metrics: ExperimentMetricResult[]): ExperimentResult['aiVsStatic'] {
    const metricOutcomes: ExperimentResult['aiVsStatic']['metricOutcomes'] = [];

    metrics.forEach((metricResult) => {
        const aiCandidates = metricResult.strategies.filter(item =>
            AI_STRATEGY_VARIANTS.has(item.strategyVariant)
        );
        const staticCandidates = metricResult.strategies.filter(item =>
            STATIC_STRATEGY_VARIANTS.has(item.strategyVariant)
        );

        const aiBest = aiCandidates[0];
        const staticBest = staticCandidates[0];

        if (!aiBest || !staticBest) {
            return;
        }

        const winner = resolveAiVsStaticWinner({
            lowerIsBetter: metricResult.lowerIsBetter,
            aiMean: aiBest.mean,
            staticMean: staticBest.mean
        });

        metricOutcomes.push({
            metric: metricResult.metric,
            lowerIsBetter: metricResult.lowerIsBetter,
            winner,
            aiBestStrategy: aiBest.strategyVariant,
            aiBestMean: aiBest.mean,
            staticBestStrategy: staticBest.strategyVariant,
            staticBestMean: staticBest.mean
        });
    });

    const aiWins = metricOutcomes.filter(item => item.winner === 'AI').length;
    const staticWins = metricOutcomes.filter(item => item.winner === 'STATIC').length;
    const ties = metricOutcomes.filter(item => item.winner === 'TIE').length;
    const evaluatedMetrics = metricOutcomes.length;
    const aiWinRate = evaluatedMetrics > 0 ? Number((aiWins / evaluatedMetrics).toFixed(4)) : 0;

    return {
        evaluatedMetrics,
        aiWins,
        staticWins,
        ties,
        aiWinRate,
        metricOutcomes
    };
}

function classifyStrategyGroup(strategyVariant: string): 'AI' | 'STATIC' | 'UNKNOWN' {
    if (AI_STRATEGY_VARIANTS.has(strategyVariant)) return 'AI';
    if (STATIC_STRATEGY_VARIANTS.has(strategyVariant)) return 'STATIC';
    return 'UNKNOWN';
}

function buildObjectiveSummary(metrics: ExperimentMetricResult[]): ExperimentResult['objectiveSummary'] {
    const targetMetric: keyof KPI = 'cistyZisk';
    const metricResult = metrics.find(metric => metric.metric === targetMetric);

    const winner = metricResult?.strategies[0];
    if (!winner) {
        return {
            objectiveMetric: targetMetric,
            winnerStrategy: 'N/A',
            winnerGroup: 'UNKNOWN',
            winnerMean: 0
        };
    }

    return {
        objectiveMetric: targetMetric,
        winnerStrategy: winner.strategyVariant,
        winnerGroup: classifyStrategyGroup(winner.strategyVariant),
        winnerMean: winner.mean
    };
}

export class ExperimentRunner {
    public run(configOverride: ExperimentRunnerConfig = {}): ExperimentResult {
        ensureExperimentsDir();

        const runsPerStrategy = Math.max(10, configOverride.runsPerStrategy ?? 10);
        const tickCount = Math.max(1, configOverride.tickCount ?? config.simulation.numberOfIterations);
        const seedPrefix = (configOverride.seedPrefix || `EXPERIMENT-${Date.now()}`).trim();
        const adaptiveCarryoverLearning = configOverride.adaptiveCarryoverLearning ?? true;

        const seeds = Array.from({ length: runsPerStrategy }, (_, index) => `${seedPrefix}-${index + 1}`);

        let scoreBoard: StrategyScores = {};
        let scoreBoardInitialized = false;
        const perRun: ExperimentResult['perRun'] = [];

        seeds.forEach((seed) => {
            const runResult = runSingleExperiment(seed, tickCount);
            const companies = runResult.companies;

            if (adaptiveCarryoverLearning) {
                persistAdaptiveLearningSnapshot();
            }

            if (!scoreBoardInitialized) {
                scoreBoard = initializeStrategyScores(companies);
                scoreBoardInitialized = true;
            }

            companies.forEach((company) => {
                const strategyVariant = company.strategyVariant || 'UNKNOWN';
                if (!scoreBoard[strategyVariant]) {
                    return;
                }

                KPI_KEYS.forEach((metric) => {
                    const metricValue = company.KPI[metric];
                    if (typeof metricValue === 'number' && Number.isFinite(metricValue)) {
                        const strategyMetrics = scoreBoard[strategyVariant];
                        if (strategyMetrics) {
                            strategyMetrics[metric].push(metricValue);
                        }
                    }
                });
            });

            perRun.push({
                seed,
                tickCount: runResult.tickCount,
                companies: companies.map((company) => ({
                    companyId: company.id,
                    companyName: company.nazev,
                    strategyVariant: company.strategyVariant,
                    kpi: company.KPI
                }))
            });
        });

        const metrics: ExperimentMetricResult[] = KPI_KEYS.map((metric) => {
            const valuesByStrategy: Record<string, number[]> = {};

            Object.entries(scoreBoard).forEach(([strategyVariant, strategyMetrics]) => {
                valuesByStrategy[strategyVariant] = strategyMetrics[metric] ?? [];
            });

            return {
                metric,
                lowerIsBetter: LOWER_IS_BETTER_METRICS.includes(metric),
                strategies: rankStrategies(metric, valuesByStrategy)
            };
        });

        const experimentId = `experiment-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        const outputPath = path.join(EXPERIMENTS_DIR, `${experimentId}.json`);

        const result: ExperimentResult = {
            experimentId,
            generatedAt: new Date().toISOString(),
            config: {
                runsPerStrategy,
                tickCount,
                seedPrefix,
                adaptiveCarryoverLearning
            },
            seeds,
            metrics,
            perRun,
            aiVsStatic: buildAiVsStaticSummary(metrics),
            objectiveSummary: buildObjectiveSummary(metrics),
            outputPath
        };

        fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');

        return result;
    }

    public list(): string[] {
        ensureExperimentsDir();
        return fs.readdirSync(EXPERIMENTS_DIR)
            .filter((fileName) => fileName.endsWith('.json'))
            .sort((a, b) => b.localeCompare(a));
    }

    public getById(fileName: string): ExperimentResult | null {
        ensureExperimentsDir();
        const safeFileName = fileName.endsWith('.json') ? fileName : `${fileName}.json`;
        const absolutePath = path.join(EXPERIMENTS_DIR, safeFileName);

        if (!fs.existsSync(absolutePath)) {
            return null;
        }

        const content = fs.readFileSync(absolutePath, 'utf-8');
        return JSON.parse(content) as ExperimentResult;
    }

    public getLatest(): ExperimentResult | null {
        const files = this.list();
        const latest = files[0];
        if (!latest) {
            return null;
        }

        return this.getById(latest);
    }
}

export const experimentRunner = new ExperimentRunner();
