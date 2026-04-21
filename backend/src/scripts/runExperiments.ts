import { experimentRunner } from '../services/experimentRunner';

type CliOptions = {
    runs?: number;
    ticks?: number;
    seedPrefix?: string;
};

function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg) continue;

        if (arg === '--runs' && argv[i + 1]) {
            options.runs = Number(argv[i + 1]);
            i++;
            continue;
        }

        if (arg === '--ticks' && argv[i + 1]) {
            options.ticks = Number(argv[i + 1]);
            i++;
            continue;
        }

        if (arg === '--seed-prefix' && argv[i + 1]) {
            options.seedPrefix = String(argv[i + 1]);
            i++;
        }
    }

    return options;
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const runConfig: {
        runsPerStrategy?: number;
        tickCount?: number;
        seedPrefix?: string;
    } = {};

    if (typeof options.runs === 'number') {
        runConfig.runsPerStrategy = options.runs;
    }
    if (typeof options.ticks === 'number') {
        runConfig.tickCount = options.ticks;
    }
    if (typeof options.seedPrefix === 'string') {
        runConfig.seedPrefix = options.seedPrefix;
    }

    const result = experimentRunner.run(runConfig);

    console.log('Experiments finished successfully');
    console.log(`Experiment ID: ${result.experimentId}`);
    console.log(`Output: ${result.outputPath}`);
    console.log(`Runs per strategy: ${result.config.runsPerStrategy}`);
    console.log(`Ticks per run: ${result.config.tickCount}`);
    console.log('Top ROI ranking:');

    const roi = result.metrics.find((metric) => metric.metric === 'ROI');
    if (roi) {
        roi.strategies.forEach((item) => {
            console.log(`  #${item.rank} ${item.strategyVariant}: mean=${item.mean}, sd=${item.standardDeviation}, CI95=[${item.ci95Low}, ${item.ci95High}]`);
        });
    }

    console.log('AI vs static summary:');
    console.log(
        `  metrics=${result.aiVsStatic.evaluatedMetrics}, ` +
        `aiWins=${result.aiVsStatic.aiWins}, ` +
        `staticWins=${result.aiVsStatic.staticWins}, ` +
        `ties=${result.aiVsStatic.ties}, ` +
        `aiWinRate=${(result.aiVsStatic.aiWinRate * 100).toFixed(1)}%`
    );

    console.log('Primary objective (max cistyZisk):');
    console.log(
        `  winner=${result.objectiveSummary.winnerStrategy} ` +
        `(${result.objectiveSummary.winnerGroup}), ` +
        `mean=${result.objectiveSummary.winnerMean}`
    );
}

main();
