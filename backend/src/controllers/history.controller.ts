import { Request, Response } from 'express';
import { simulationHistory, SimulationMetadata, SimulationHistoryRecord } from '../utils/simulationHistory';

// Get list of all simulations
export function getSimulationHistoryList(req: Request, res: Response) {
    try {
        const histories = simulationHistory.getHistoryList();
        console.log(`[History] Got ${histories.length} simulations from history`);
        res.json({
            total: histories.length,
            simulations: histories.map(metadata => ({
                id: metadata.id,
                seed: metadata.seed,
                startedAt: metadata.startedAt,
                endedAt: metadata.endedAt,
                finalTick: metadata.finalTick,
                companyCount: metadata.companyCount,
                buildingCount: metadata.buildingCount,
                regionName: metadata.regionName,
                duration: metadata.endedAt ? metadata.endedAt - metadata.startedAt : null
            }))
        });
    } catch (error) {
        console.error('Error getting simulation history list:', error);
        res.status(500).json({ error: 'Failed to get simulation history', details: String(error) });
    }
}

// Get detail of a specific simulation with snapshots
export function getSimulationDetail(req: Request, res: Response) {
    try {
        const simulationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        
        console.log(`[History] Getting detail for simulation: ${simulationId}`);
        
        if (!simulationId) {
            return res.status(400).json({ error: 'Simulation ID is required' });
        }

        const history = simulationHistory.getSimulationHistory(simulationId);
        
        if (!history) {
            console.warn(`[History] Simulation not found: ${simulationId}`);
            return res.status(404).json({ error: 'Simulation not found' });
        }

        console.log(`[History] Found simulation with ${history.snapshots?.length || 0} snapshots`);

        res.json({
            metadata: {
                id: history.metadata.id,
                seed: history.metadata.seed,
                startedAt: history.metadata.startedAt,
                endedAt: history.metadata.endedAt,
                finalTick: history.metadata.finalTick,
                companyCount: history.metadata.companyCount,
                buildingCount: history.metadata.buildingCount,
                regionName: history.metadata.regionName
            },
            snapshotCount: history.snapshots?.length || 0,
            availableTicks: history.snapshots?.map(s => s.tick) || []
        });
    } catch (error) {
        console.error('Error getting simulation detail:', error);
        res.status(500).json({ error: 'Failed to get simulation detail' });
    }
}

// Get snapshot at specific tick
export function getSnapshotAtTick(req: Request, res: Response) {
    try {
        const simulationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const tickParam = Array.isArray(req.params.tick) ? req.params.tick[0] : req.params.tick;
        const tick = tickParam ? parseInt(tickParam, 10) : NaN;

        console.log(`[History] getSnapshotAtTick called:`, { simulationId, tickParam, tick });

        if (!simulationId) {
            console.warn(`[History] Missing simulation ID`);
            return res.status(400).json({ error: 'Simulation ID is required' });
        }

        if (isNaN(tick)) {
            console.warn(`[History] Invalid tick: ${tickParam}`);
            return res.status(400).json({ error: 'Valid tick number is required' });
        }

        const snapshot = simulationHistory.getSnapshotAtTick(simulationId, tick);

        if (!snapshot) {
            console.warn(`[History] No snapshot found for sim ${simulationId} at tick ${tick}`);
            return res.status(404).json({ 
                error: 'Snapshot not found for specified tick',
                details: { simulationId, tick }
            });
        }

        console.log(`[History] Snapshot found for sim ${simulationId} at tick ${snapshot.tick}`);
        res.json({
            tick: snapshot.tick,
            timestamp: snapshot.timestamp,
            state: snapshot.state
        });
    } catch (error) {
        console.error('Error getting snapshot:', error);
        res.status(500).json({ error: 'Failed to get snapshot', details: String(error) });
    }
}

// Get KPI timeline for a specific company
export function getCompanyKPITimeline(req: Request, res: Response) {
    try {
        const simulationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const companyIdParam = req.params.companyId ? (Array.isArray(req.params.companyId) ? req.params.companyId[0] : req.params.companyId) : null;
        const companyId = companyIdParam ? parseInt(companyIdParam, 10) : null;

        if (!simulationId) {
            return res.status(400).json({ error: 'Simulation ID is required' });
        }

        const history = simulationHistory.getSimulationHistory(simulationId);
        
        if (!history || !history.snapshots) {
            return res.status(404).json({ error: 'Simulation not found' });
        }

        // Extract KPI timeline from snapshots
        const timeline = history.snapshots.map(snapshot => {
            const agents = (snapshot.state.agents || []) as Array<Record<string, unknown>>;
            
            if (!companyId) {
                // Return all companies KPI data for this tick
                const companies = agents.filter((agent) => (agent.constructor as any)?.name === 'Firma' || agent.KPI);
                return {
                    tick: snapshot.tick,
                    timestamp: snapshot.timestamp,
                    companies: companies.map((c) => {
                        const budovy = Array.isArray(c.budovy) ? c.budovy.length : 0;
                        return {
                            id: c.id,
                            name: (c.nazev || c.name || `Company-${c.id}`) as string,
                            KPI: c.KPI,
                            finance: c.finance,
                            budovy
                        };
                    })
                };
            } else {
                // Return specific company KPI data
                const company = agents.find((a) => a.id === companyId && ((a.constructor as any)?.name === 'Firma' || a.KPI));
                return {
                    tick: snapshot.tick,
                    timestamp: snapshot.timestamp,
                    company: company ? {
                        id: company.id,
                        name: (company.nazev || company.name || `Company-${company.id}`) as string,
                        KPI: company.KPI,
                        finance: company.finance,
                        budovy: Array.isArray(company.budovy) ? company.budovy.length : 0
                    } : null
                };
            }
        });

        res.json({
            simulationId,
            companyId: companyId || null,
            timeline
        });
    } catch (error) {
        console.error('Error getting company KPI timeline:', error);
        res.status(500).json({ error: 'Failed to get KPI timeline' });
    }
}

// Delete a simulation from history
export function deleteSimulation(req: Request, res: Response) {
    try {
        const simulationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

        if (!simulationId) {
            return res.status(400).json({ error: 'Simulation ID is required' });
        }

        const success = simulationHistory.deleteSimulation(simulationId);

        if (!success) {
            return res.status(404).json({ error: 'Simulation not found' });
        }

        res.json({ message: 'Simulation deleted successfully' });
    } catch (error) {
        console.error('Error deleting simulation:', error);
        res.status(500).json({ error: 'Failed to delete simulation' });
    }
}

// Export experiment-ready dataset from simulation history
export function exportSimulationDataset(req: Request, res: Response) {
    try {
        const simulationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const format = String(req.query.format || 'json').toLowerCase();
        const mode = String(req.query.mode || 'final').toLowerCase();

        if (!simulationId) {
            return res.status(400).json({ error: 'Simulation ID is required' });
        }

        const history = simulationHistory.getSimulationHistory(simulationId);
        if (!history || !history.snapshots || history.snapshots.length === 0) {
            return res.status(404).json({ error: 'Simulation not found or has no snapshots' });
        }

        const finalSnapshot = history.snapshots[history.snapshots.length - 1];
        if (!finalSnapshot) {
            return res.status(404).json({ error: 'Simulation has no final snapshot' });
        }

        const snapshots = mode === 'timeline'
            ? history.snapshots
            : [finalSnapshot];

        const rows: Array<Record<string, any>> = [];
        snapshots.forEach(snapshot => {
            const agents = snapshot.state?.agents || [];
            const companies = agents.filter((agent: any) => agent?.KPI !== undefined);

            companies.forEach((company: any) => {
                rows.push({
                    simulationId,
                    seed: history.metadata.seed,
                    tick: snapshot.tick,
                    timestamp: snapshot.timestamp,
                    companyId: company.id,
                    companyName: company.nazev || company.name || `Company-${company.id}`,
                    strategyVariant: company.strategyVariant || 'UNKNOWN',
                    finance: company.finance,
                    ROI: company.KPI?.ROI,
                    cistyZisk: company.KPI?.cistyZisk,
                    celkovaInvestice: company.KPI?.celkovaInvestice,
                    financniRezerva: company.KPI?.financniRezerva,
                    miraNesplnenePoptavky: company.KPI?.miraNesplnenePoptavky,
                    miraVyuzitiSkladovaciJednotky: company.KPI?.miraVyuzitiSkladovaciJednotky,
                    miraVyuzitiVyrobniKapacity: company.KPI?.miraVyuzitiVyrobniKapacity,
                    prumernaDobaCekaniSurovin: company.KPI?.prumernaDobaCekaniSurovin,
                    spotrebaEnergie: company.KPI?.spotrebaEnergie
                });
            });
        });

        if (format === 'csv') {
            const firstRow = rows[0];
            const headers = firstRow
                ? Object.keys(firstRow)
                : [
                    'simulationId', 'seed', 'tick', 'timestamp', 'companyId', 'companyName',
                    'strategyVariant', 'finance', 'ROI', 'cistyZisk', 'celkovaInvestice',
                    'financniRezerva', 'miraNesplnenePoptavky', 'miraVyuzitiSkladovaciJednotky',
                    'miraVyuzitiVyrobniKapacity', 'prumernaDobaCekaniSurovin', 'spotrebaEnergie'
                ];

            const escapeCsv = (value: any) => {
                const text = value === undefined || value === null ? '' : String(value);
                const escaped = text.replace(/"/g, '""');
                return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
            };

            const csvLines = [
                headers.join(','),
                ...rows.map(row => headers.map(key => escapeCsv(row[key])).join(','))
            ];
            const csv = csvLines.join('\n');

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${simulationId}-${mode}.csv"`);
            return res.send(csv);
        }

        res.json({
            simulationId,
            mode,
            rowCount: rows.length,
            rows
        });
    } catch (error) {
        console.error('Error exporting simulation dataset:', error);
        res.status(500).json({ error: 'Failed to export simulation dataset', details: String(error) });
    }
}
