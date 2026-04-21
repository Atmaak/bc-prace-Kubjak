export type NumericSummary = {
    mean: number;
    standardDeviation: number;
    ci95Low: number;
    ci95High: number;
    sampleSize: number;
};

const round = (value: number, decimals: number = 4): number => {
    return Number(value.toFixed(decimals));
};

export function mean(values: number[]): number {
    if (values.length === 0) return 0;
    const total = values.reduce((sum, value) => sum + value, 0);
    return total / values.length;
}

export function standardDeviation(values: number[]): number {
    if (values.length <= 1) return 0;
    const avg = mean(values);
    const variance = values.reduce((sum, value) => {
        const diff = value - avg;
        return sum + diff * diff;
    }, 0) / (values.length - 1);

    return Math.sqrt(variance);
}

export function confidenceInterval95(values: number[]): { low: number; high: number } {
    if (values.length === 0) return { low: 0, high: 0 };

    const avg = mean(values);
    const sd = standardDeviation(values);
    const margin = values.length > 0 ? 1.96 * (sd / Math.sqrt(values.length)) : 0;

    return {
        low: avg - margin,
        high: avg + margin
    };
}

export function summarize(values: number[]): NumericSummary {
    const avg = mean(values);
    const sd = standardDeviation(values);
    const ci95 = confidenceInterval95(values);

    return {
        mean: round(avg),
        standardDeviation: round(sd),
        ci95Low: round(ci95.low),
        ci95High: round(ci95.high),
        sampleSize: values.length
    };
}
