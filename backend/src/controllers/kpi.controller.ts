import { Request, Response } from 'express';
import { SimulationEngine } from '../simulation';
import { Firma } from '../types/firma';
import { Agent } from '../types/agent';

let simulation: SimulationEngine | null = null;

export function setSimulation(sim: SimulationEngine) {
    simulation = sim;
}

// Get KPI data for all companies
export function getAllCompanyKPIs(req: Request, res: Response) {
    if (!simulation) {
        return res.status(503).json({ error: 'Simulation not initialized' });
    }

    const companies = simulation.getAgents().filter((agent: Agent): agent is Firma => agent instanceof Firma);
    
    const kpiData = companies.map((company: Firma) => ({
        id: company.id,
        nazev: company['nazev'] || company['name'] || `Company-${company.id}`,
        strategyVariant: company['strategyVariant'] || 'UNKNOWN',
        finance: company.finance,
        KPI: company.KPI
    }));

    res.json({
        tick: simulation['currentTime'] || 0,
        companyCount: companies.length,
        companies: kpiData
    });
}

// Get KPI data for a specific company
export function getCompanyKPI(req: Request, res: Response) {
    if (!simulation) {
        return res.status(503).json({ error: 'Simulation not initialized' });
    }

    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const companyId = parseInt(idParam || '0', 10);
    const companies = simulation.getAgents().filter((agent: Agent): agent is Firma => agent instanceof Firma);
    const company = companies.find((c: Firma) => c.id === companyId);

    if (!company) {
        return res.status(404).json({ error: 'Company not found' });
    }

    res.json({
        id: company.id,
        nazev: company['nazev'] || company['name'] || `Company-${company.id}`,
        strategyVariant: company['strategyVariant'] || 'UNKNOWN',
        finance: company.finance,
        KPI: company.KPI,
        tick: simulation['currentTime'] || 0
    });
}

// Get KPI comparison ranks
export function getKPIComparison(req: Request, res: Response) {
    if (!simulation) {
        return res.status(503).json({ error: 'Simulation not initialized' });
    }

    const companies = simulation.getAgents().filter((agent: Agent): agent is Firma => agent instanceof Firma);
    
    const kpiMetrics = [
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
    ] as const;

    const rankings: any = {};

    kpiMetrics.forEach(metric => {
        const sorted = [...companies].sort((a, b) => {
            // For unmet demand and wait time, lower is better
            const isLowerBetter =
                metric === 'miraNesplnenePoptavky' ||
                metric === 'prumernaDobaCekaniSurovin' ||
                metric === 'nakladovostTrzeb';
            const aValue = a.KPI[metric];
            const bValue = b.KPI[metric];
            return isLowerBetter ? aValue - bValue : bValue - aValue;
        });

        rankings[metric] = sorted.map((company, index) => ({
            rank: index + 1,
            companyId: company.id,
            companyName: company['nazev'] || company['name'] || `Company-${company.id}`,
            strategyVariant: company['strategyVariant'] || 'UNKNOWN',
            value: company.KPI[metric]
        }));
    });

    res.json({
        tick: simulation['currentTime'] || 0,
        rankings
    });
}

// Get aggregated statistics across all companies
export function getKPIStatistics(req: Request, res: Response) {
    if (!simulation) {
        return res.status(503).json({ error: 'Simulation not initialized' });
    }

    const companies = simulation.getAgents().filter((agent: Agent): agent is Firma => agent instanceof Firma);
    
    if (companies.length === 0) {
        return res.json({ error: 'No companies found' });
    }

    const stats: any = {
        totalCompanies: companies.length,
        totalFinance: 0,
        totalInvestment: 0,
        totalProfit: 0,
        averageROI: 0,
        averageOperatingMargin: 0,
        averageOrderFulfillment: 0,
        averageLiquidityCoverage: 0,
        averageProductionUtilization: 0,
        averageStorageUtilization: 0,
        topPerformer: null,
        bottomPerformer: null
    };

    companies.forEach((company: Firma) => {
        stats.totalFinance += company.finance;
        stats.totalInvestment += company.KPI.celkovaInvestice;
        stats.totalProfit += company.KPI.cistyZisk;
        stats.averageROI += company.KPI.ROI;
        stats.averageOperatingMargin += company.KPI.provozniMarze;
        stats.averageOrderFulfillment += company.KPI.uspesnostPlneniObjednavek;
        stats.averageLiquidityCoverage += company.KPI.likviditniKrytiProvozu;
        stats.averageProductionUtilization += company.KPI.miraVyuzitiVyrobniKapacity;
        stats.averageStorageUtilization += company.KPI.miraVyuzitiSkladovaciJednotky;
    });

    stats.averageROI /= companies.length;
    stats.averageOperatingMargin /= companies.length;
    stats.averageOrderFulfillment /= companies.length;
    stats.averageLiquidityCoverage /= companies.length;
    stats.averageProductionUtilization /= companies.length;
    stats.averageStorageUtilization /= companies.length;

    // Find top and bottom performers by ROI
    const sortedByROI = [...companies].sort((a, b) => b.KPI.ROI - a.KPI.ROI);
    const topCompany = sortedByROI[0];
    const bottomCompany = sortedByROI[sortedByROI.length - 1];

    if (topCompany) {
        stats.topPerformer = {
            id: topCompany.id,
            name: topCompany['nazev'] || topCompany['name'],
            strategyVariant: topCompany['strategyVariant'],
            ROI: topCompany.KPI.ROI,
            profit: topCompany.KPI.cistyZisk
        };
    }

    if (bottomCompany) {
        stats.bottomPerformer = {
            id: bottomCompany.id,
            name: bottomCompany['nazev'] || bottomCompany['name'],
            strategyVariant: bottomCompany['strategyVariant'],
            ROI: bottomCompany.KPI.ROI,
            profit: bottomCompany.KPI.cistyZisk
        };
    }

    res.json({
        tick: simulation['currentTime'] || 0,
        statistics: stats
    });
}
