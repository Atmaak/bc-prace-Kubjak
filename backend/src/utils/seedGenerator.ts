import { createRng } from './rng';

/**
 * Generate a deterministic random seed string based on a base seed and index
 * Used for learning mode to ensure reproducible simulations while varying parameters
 */
export class SeededSeedGenerator {
    private baseRng: () => number;
    private iteration: number = 0;

    constructor(baseSeed: string) {
        this.baseRng = createRng(baseSeed);
    }

    /**
     * Generate next seed
     * Combines base seed + iteration number + random value for uniqueness
     */
    public nextSeed(): string {
        const randomValue = this.baseRng();
        const randomHex = Math.floor(randomValue * 0xFFFFFF).toString(16).padStart(6, '0');
        const seed = `ADAPTIVE_LEARNING_${this.iteration}_${randomHex}`;
        this.iteration++;
        return seed;
    }

    /**
     * Get current iteration count
     */
    public getIteration(): number {
        return this.iteration;
    }

    /**
     * Reset iteration counter and create new RNG
     */
    public reset(baseSeed: string): void {
        this.baseRng = createRng(baseSeed);
        this.iteration = 0;
    }
}
