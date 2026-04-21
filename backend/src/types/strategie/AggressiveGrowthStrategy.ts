import { Strategie } from '../strategie';
import { Firma } from '../firma';
import { Dodavatel } from '../dodavatel';
import { TypSuroviny } from '../typSuroviny';
import { getGeoDistance } from '../../utils/distance';
import { SimulationEngine } from '../../simulation';
import { StrategyDecisionContext } from '../simulationEvent';
import config from '../../config.json';

/**
 * Aggressive Growth Strategy
 * Focuses on expansion and market growth
 * Orders large quantities, willing to pay premium for speed/proximity
 */
export class AggressiveGrowthStrategy implements Strategie {
    private jmeno = "Aggressive Growth Strategy";
    private w_cena: number = config.strategie.aggressive.supplierWeights.price;
    private w_vzdalenost: number = config.strategie.aggressive.supplierWeights.distance;

    public vykonejRozhodnuti(firma: Firma, tick: number, sim?: SimulationEngine): void {
        if (sim) {
            const logger = sim.getLogger();
            const suppliers = sim.getDodavatele();

            // Get max production capacity
            const maxCapacity = firma.getMaxProductionCapacity();
            
            // Aggressive strategy: Try to produce at 100% capacity
            const desiredProduction = Math.floor(maxCapacity * config.strategie.aggressive.productionRate);

            // Check if we should expand first
            if (firma.shouldExpand() && tick % config.strategie.aggressive.expandEveryTicks === 0) {
                const expandedProduction = firma.expandProduction(tick);
                const expandedStorage = firma.expandStorage(tick);
                const expanded = expandedProduction || expandedStorage;
                if (expanded) {
                    logger.logEvent(
                        logger.createEvent(tick, 'STRATEGY_DECISION_MADE', firma.id, {
                            strategyName: this.jmeno,
                            decision: 'EXPAND_PRODUCTION_AND_STORAGE',
                            rationale: 'Expanding both production and storage capacity for growth'
                        }, { companyId: firma.id, strategyId: this.jmeno })
                    );
                }
            }

            // Buy supplies dynamically based on current inventory and needs
            firma.buySuppliesDynamically(tick);

            // Produce at maximum capacity
            const produced = firma.produce(desiredProduction, tick);

            // Sell immediately after production
            if (produced > 0) {
                firma.sellProduct(produced, TypSuroviny.OCEL, tick);
            }

            logger.logEvent(
                logger.createEvent(tick, 'STRATEGY_DECISION_MADE', firma.id, {
                    strategyName: this.jmeno,
                    decision: 'AGGRESSIVE_PRODUCTION',
                    maxCapacity: maxCapacity,
                    desiredProduction: desiredProduction,
                    actuallyProduced: produced,
                    rationale: 'Maximize production - produce and sell at full capacity'
                }, { companyId: firma.id, strategyId: this.jmeno })
            );
        }
    }

    /**
     * Aggressive growth strategy spends at most 50 % of current finances on supplies
     * per tick – maximises throughput at the cost of higher financial risk.
     */
    public getSupplySpendRatio(): number {
        return config.strategie.aggressive.supplySpendRatio;
    }

    public zjistiDodavatele(
        firma: Firma,
        dodavatele: Dodavatel[],
        typSuroviny: TypSuroviny
    ): Dodavatel | null {
        const kandidati = dodavatele.filter(d => d.typSuroviny === typSuroviny);
        if (kandidati.length === 0) return null;

        let scored = kandidati.map(d => ({
            dodavatel: d,
            vzdalenost: getGeoDistance(d.poloha, firma.poloha),
            skore: 0
        }));

        const maxCena = Math.max(...scored.map(h => h.dodavatel.cena));
        const minCena = Math.min(...scored.map(h => h.dodavatel.cena));
        const maxVzd = Math.max(...scored.map(h => h.vzdalenost));
        const minVzd = Math.min(...scored.map(h => h.vzdalenost));

        const rozptylCena = maxCena - minCena || 1;
        const rozptylVzd = maxVzd - minVzd || 1;

        scored.forEach(h => {
            const normCena = 1 - ((h.dodavatel.cena - minCena) / rozptylCena);
            const normVzd = 1 - ((h.vzdalenost - minVzd) / rozptylVzd);
            h.skore = (normCena * this.w_cena) + (normVzd * this.w_vzdalenost);
        });

        scored.sort((a, b) => b.skore - a.skore);
        return scored[0]?.dodavatel || null;
    }
}
