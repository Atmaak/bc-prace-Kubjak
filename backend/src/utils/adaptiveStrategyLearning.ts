import fs from 'fs';
import path from 'path';

interface AdaptiveStrategyWeights {
    timestamp: string;
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
    performance: Array<{
        id: number;
        supplierId: number;
        successCount: number;
        failureCount: number;
        totalCostPaid: number;
        totalQuantity: number;
        avgDeliveryTime: number;
        lastUsedTick: number;
    }>;
}

const WEIGHTS_DIR = path.resolve(process.cwd(), 'adaptive-weights');
const DEFAULT_STRATEGY_KEY = 'adaptive';
const LEGACY_WEIGHTS_FILE = path.join(WEIGHTS_DIR, 'adaptive-strategy-weights.json');
const LEARNING_HISTORY_FILE = path.join(WEIGHTS_DIR, 'learning-history.jsonl');

function normalizeStrategyKey(strategyKey?: string): string {
    const normalized = (strategyKey ?? DEFAULT_STRATEGY_KEY)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_');

    return normalized.length > 0 ? normalized : DEFAULT_STRATEGY_KEY;
}

function getWeightsFile(strategyKey?: string): string {
    const normalized = normalizeStrategyKey(strategyKey);
    if (normalized === DEFAULT_STRATEGY_KEY) {
        return LEGACY_WEIGHTS_FILE;
    }

    return path.join(WEIGHTS_DIR, `adaptive-strategy-weights-${normalized}.json`);
}

/**
 * Initialize weights directory if it doesn't exist
 */
function ensureWeightsDir(): void {
    if (!fs.existsSync(WEIGHTS_DIR)) {
        fs.mkdirSync(WEIGHTS_DIR, { recursive: true });
    }
}

/**
 * Save adaptive strategy weights to disk
 * Overwrites previous weights and adds entry to learning history
 */
export function saveAdaptiveWeights(weights: AdaptiveStrategyWeights, strategyKey?: string): void {
    ensureWeightsDir();
    const key = normalizeStrategyKey(strategyKey);
    const weightsFile = getWeightsFile(key);

    // Save current weights (overwrite previous)
    fs.writeFileSync(weightsFile, JSON.stringify(weights, null, 2), 'utf8');

    // Append to learning history (for analysis of learning progression)
    const historyEntry = {
        timestamp: weights.timestamp,
        strategyKey: key,
        w_cena: weights.w_cena,
        w_vzdalenost: weights.w_vzdalenost,
        w_reliability: weights.w_reliability,
                w_deliveryTime: weights.w_deliveryTime ?? null,
                w_availability: weights.w_availability ?? null,
        overallSuccessRate: weights.performance.length > 0
            ? weights.performance.reduce((sum, p) => sum + p.successCount, 0) /
              Math.max(weights.performance.reduce((sum, p) => sum + p.successCount + p.failureCount, 1), 1)
            : 0,
        totalDecisions: weights.totalDecisions,
                cumulativeReward: weights.cumulativeReward,
                growthAggression: weights.growthAggression ?? null,
        expansionLearningReward: weights.expansionLearningReward ?? null,
        kpiCompetitiveReward: weights.kpiCompetitiveReward ?? null
    };

    fs.appendFileSync(
        LEARNING_HISTORY_FILE,
        JSON.stringify(historyEntry) + '\n',
        'utf8'
    );
}

/**
 * Load last saved adaptive strategy weights from disk
 * Returns null if no saved weights exist
 */
export function loadAdaptiveWeights(strategyKey?: string): AdaptiveStrategyWeights | null {
    ensureWeightsDir();
    const weightsFile = getWeightsFile(strategyKey);

    if (!fs.existsSync(weightsFile)) {
        return null;
    }

    try {
        const content = fs.readFileSync(weightsFile, 'utf8');
        return JSON.parse(content) as AdaptiveStrategyWeights;
    } catch (error) {
        console.error('Error loading adaptive weights:', error);
        return null;
    }
}

/**
 * Get learning history - shows progression of weights over simulations
 * Useful for analyzing if the strategy is actually improving
 */
export function getLearningHistory(): Array<{
    timestamp: string;
    w_cena: number;
    w_vzdalenost: number;
    w_reliability: number;
    w_deliveryTime?: number | null;
    w_availability?: number | null;
    overallSuccessRate: number;
    totalDecisions: number;
    cumulativeReward: number;
}> {
    ensureWeightsDir();

    if (!fs.existsSync(LEARNING_HISTORY_FILE)) {
        return [];
    }

    try {
        const content = fs.readFileSync(LEARNING_HISTORY_FILE, 'utf8');
        return content
            .split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line));
    } catch (error) {
        console.error('Error loading learning history:', error);
        return [];
    }
}

/**
 * Clear all learning data (for testing or reset)
 */
export function clearLearningData(): void {
    ensureWeightsDir();

    const weightFiles = fs
        .readdirSync(WEIGHTS_DIR)
        .filter(fileName => /^adaptive-strategy-weights(?:-[a-z0-9_-]+)?\.json$/i.test(fileName));

    weightFiles.forEach(fileName => {
        fs.unlinkSync(path.join(WEIGHTS_DIR, fileName));
    });

    if (fs.existsSync(LEARNING_HISTORY_FILE)) {
        fs.unlinkSync(LEARNING_HISTORY_FILE);
    }
}

/**
 * Get file path to weights directory (for external access)
 */
export function getWeightsDirectory(): string {
    return WEIGHTS_DIR;
}
