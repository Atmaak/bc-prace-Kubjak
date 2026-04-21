import fs from 'fs';
import path from 'path';
import { SimulationEngine } from '../simulation';
import { Firma } from '../types/firma';

export interface SerializedSimulationState {
    time: number;
    tick: number;
    seed: string;
    running: boolean;
    finished: boolean;
    summaries: {
        totalAgents: number;
        avgTickDurationMs: number;
    };
    logMetadata: {
        filePath: string | null;
        eventCount: number;
        note: string;
    };
    region: {
        id: number;
        nazev: string;
    };
    agents: Array<unknown>;
    buildings: Array<unknown>;
}

export interface SimulationTickSnapshot {
    tick: number;
    timestamp: number;
    state: SerializedSimulationState;
}

export interface SimulationMetadata {
    id: string;
    seed: string;
    startedAt: number;
    endedAt?: number;
    finalTick: number;
    companyCount: number;
    buildingCount: number;
    regionName: string;
    snapshotsPath: string; // Path to the snapshots file
}

export interface SimulationHistoryRecord {
    metadata: SimulationMetadata;
    snapshots?: SimulationTickSnapshot[]; // Only loaded when needed
}

const HISTORY_DIR = path.resolve(process.cwd(), 'simulation-history');
const METADATA_FILE = path.join(HISTORY_DIR, 'history.json');
const SNAPSHOTS_INTERVAL = 50; // Save snapshot every 50 ticks (reduced from 100 for more data points)

class SimulationHistoryManager {
    private history: Map<string, SimulationMetadata> = new Map();
    private currentSimulationId: string | null = null;
    private currentSnapshots: SimulationTickSnapshot[] = [];
    private lastSnapshotTick: number = 0;

    constructor() {
        this.ensureDirectories();
        this.loadHistory();
    }

    private ensureDirectories() {
        if (!fs.existsSync(HISTORY_DIR)) {
            fs.mkdirSync(HISTORY_DIR, { recursive: true });
        }
    }

    private loadHistory() {
        try {
            if (fs.existsSync(METADATA_FILE)) {
                const data = fs.readFileSync(METADATA_FILE, 'utf-8');
                const records = JSON.parse(data) as SimulationHistoryRecord[];
                records.forEach(record => {
                    this.history.set(record.metadata.id, record.metadata);
                });
            }
        } catch (error) {
            console.error('Error loading simulation history:', error);
        }
    }

    public startNewSimulation(simulation: SimulationEngine, seed: string, regionName: string): string {
        const simulationId = `sim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const companies = simulation.getAgents().filter((agent): agent is Firma => agent instanceof Firma);
        const buildings = simulation.getRegion().getPurchasedBuildings();

        const metadata: SimulationMetadata = {
            id: simulationId,
            seed,
            startedAt: Date.now(),
            finalTick: 0,
            companyCount: companies.length,
            buildingCount: buildings.length,
            regionName,
            snapshotsPath: path.join(HISTORY_DIR, `${simulationId}-snapshots.json`)
        };

        this.history.set(simulationId, metadata);
        this.currentSimulationId = simulationId;
        this.currentSnapshots = [];
        this.lastSnapshotTick = 0;

        return simulationId;
    }

    public recordSnapshot(simulation: SimulationEngine) {
        if (!this.currentSimulationId) return;

        const currentTick = simulation.getCurrentTick();

        // Only save every SNAPSHOTS_INTERVAL ticks to reduce file size
        if (currentTick - this.lastSnapshotTick >= SNAPSHOTS_INTERVAL || currentTick === 1) {
            const state = simulation.serializeState() as SerializedSimulationState;
            
            // Log detailed info about what we're saving (less frequently to avoid spam)
            if (currentTick === 1 || currentTick % (SNAPSHOTS_INTERVAL * 3) === 0) {
                const agentSummary = state.agents?.map((a) => {
                    const agent = a as Record<string, unknown>;
                    return {
                        id: agent.id,
                        name: (agent.name || agent.nazev || 'unnamed') as string,
                        type: (agent.constructor as any)?.name || 'unknown',
                        hasKPI: !!agent.KPI,
                        hasFinance: !!agent.finance,
                        hasNazev: !!agent.nazev,
                    };
                }) || [];
                console.log(`[SimulationHistory] Snapshot at tick ${currentTick}:`, {
                    agentCount: state.agents?.length,
                    summary: agentSummary,
                });
            }

            const snapshot: SimulationTickSnapshot = {
                tick: currentTick,
                timestamp: Date.now(),
                state: state
            };

            this.currentSnapshots.push(snapshot);
            this.lastSnapshotTick = currentTick;
        }
    }

    public finishSimulation(simulation: SimulationEngine) {
        if (!this.currentSimulationId) return;

        const metadata = this.history.get(this.currentSimulationId);
        if (!metadata) return;

        // Save final snapshot
        const finalTick = simulation.getCurrentTick();
        const snapshot: SimulationTickSnapshot = {
            tick: finalTick,
            timestamp: Date.now(),
            state: simulation.serializeState() as SerializedSimulationState
        };
        this.currentSnapshots.push(snapshot);

        // Update metadata
        metadata.endedAt = Date.now();
        metadata.finalTick = finalTick;
        const companies = simulation.getAgents().filter((agent): agent is Firma => agent instanceof Firma);
        const buildings = simulation.getRegion().getPurchasedBuildings();
        metadata.companyCount = companies.length;
        metadata.buildingCount = buildings.length;

        // Save snapshots to file
        try {
            fs.writeFileSync(
                metadata.snapshotsPath,
                JSON.stringify(this.currentSnapshots, null, 2),
                'utf-8'
            );
        } catch (error) {
            console.error('Error saving simulation snapshots:', error);
        }

        // Save metadata
        this.saveMetadata();

        this.currentSimulationId = null;
        this.currentSnapshots = [];
    }

    private saveMetadata() {
        try {
            const records: SimulationHistoryRecord[] = Array.from(this.history.values()).map(metadata => ({
                metadata
            }));
            fs.writeFileSync(METADATA_FILE, JSON.stringify(records, null, 2), 'utf-8');
        } catch (error) {
            console.error('Error saving simulation metadata:', error);
        }
    }

    public getHistoryList(): SimulationMetadata[] {
        return Array.from(this.history.values())
            .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    }

    public getSimulationHistory(simulationId: string): SimulationHistoryRecord | null {
        const metadata = this.history.get(simulationId);
        if (!metadata) return null;

        // Load snapshots from file
        let snapshots: SimulationTickSnapshot[] = [];
        try {
            if (fs.existsSync(metadata.snapshotsPath)) {
                const data = fs.readFileSync(metadata.snapshotsPath, 'utf-8');
                snapshots = JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading snapshots for simulation', simulationId, error);
        }

        return {
            metadata,
            snapshots
        };
    }

    public getSnapshotAtTick(simulationId: string, tick: number): SimulationTickSnapshot | null {
        const history = this.getSimulationHistory(simulationId);
        if (!history || !history.snapshots) {
            console.log(`[SimulationHistory] No history found for simulation ${simulationId}`);
            return null;
        }

        if (history.snapshots.length === 0) {
            console.log(`[SimulationHistory] No snapshots available for simulation ${simulationId}`);
            return null;
        }

        console.log(`[SimulationHistory] Looking for snapshot at tick ${tick}, available ticks: ${history.snapshots.map(s => s.tick).join(', ')}`);

        // Find exact tick or closest previous tick
        let closestSnapshot = null;
        for (const snapshot of history.snapshots) {
            if (snapshot.tick <= tick) {
                closestSnapshot = snapshot;
            }
            if (snapshot.tick > tick) {
                // If we haven't found a snapshot <= tick yet, use this one
                if (!closestSnapshot) {
                    closestSnapshot = snapshot;
                }
                break;
            }
        }

        if (closestSnapshot) {
            console.log(`[SimulationHistory] Found closest snapshot at tick ${closestSnapshot.tick} (requested: ${tick})`);
        } else {
            console.log(`[SimulationHistory] No snapshot found for tick ${tick}`);
        }

        return closestSnapshot;
    }

    public deleteSimulation(simulationId: string): boolean {
        const metadata = this.history.get(simulationId);
        if (!metadata) return false;

        try {
            // Delete snapshots file
            if (fs.existsSync(metadata.snapshotsPath)) {
                fs.unlinkSync(metadata.snapshotsPath);
            }

            // Remove from history
            this.history.delete(simulationId);

            // Save updated metadata
            this.saveMetadata();

            return true;
        } catch (error) {
            console.error('Error deleting simulation', simulationId, error);
            return false;
        }
    }
}

// Export singleton instance
export const simulationHistory = new SimulationHistoryManager();
