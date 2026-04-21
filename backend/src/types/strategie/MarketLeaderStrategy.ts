import { Strategie } from '../strategie';
import { Firma } from '../firma';
import { Dodavatel } from '../dodavatel';
import { TypSuroviny } from '../typSuroviny';
import { getGeoDistance } from '../../utils/distance';
import { SimulationEngine } from '../../simulation';
import config from '../../config.json';

/**
 * Market Leader Strategy
 * Focuses on securing supply through aggressive purchasing
 * Orders from closest suppliers to ensure demand satisfaction
 * Willing to pay premium for control over supply chain
 */
export class MarketLeaderStrategy implements Strategie {
    private jmeno = "Market Leader Strategy";
    private w_cena: number = config.strategie.marketLeader.supplierWeights.price;
    private w_vzdalenost: number = config.strategie.marketLeader.supplierWeights.distance;

    public vykonejRozhodnuti(firma: Firma, tick: number, sim?: SimulationEngine): void {
        if (sim) {
            const logger = sim.getLogger();
            const suppliers = sim.getDodavatele();

            // Get max production capacity
            const maxCapacity = firma.getMaxProductionCapacity();
            
            // Market Leader strategy: Produce at 90% capacity (high but sustainable)
            const desiredProduction = Math.floor(maxCapacity * config.strategie.marketLeader.productionRate);

            // Aggressive expansion if profitable
            if (firma.shouldExpand() && tick % config.strategie.marketLeader.expandEveryTicks === 0) {
                firma.expandProduction(tick);
                firma.expandStorage(tick);
            }

            // Buy supplies dynamically based on current inventory and needs
            firma.buySuppliesDynamically(tick);

            // Produce at high capacity
            const produced = firma.produce(desiredProduction, tick);

            // Sell immediately after production
            if (produced > 0) {
                firma.sellProduct(produced, TypSuroviny.OCEL, tick);
            }

            logger.logEvent(
                logger.createEvent(tick, 'STRATEGY_DECISION_MADE', firma.id, {
                    strategyName: this.jmeno,
                    decision: 'MARKET_LEADER_PRODUCTION',
                    maxCapacity: maxCapacity,
                    desiredProduction: desiredProduction,
                    actuallyProduced: produced,
                    rationale: 'Dominate market - produce at 90% capacity for high output'
                }, { companyId: firma.id, strategyId: this.jmeno })
            );
        }
    }

    /**
     * Market leader strategy spends at most 40 % of current finances on supplies
     * per tick – prioritises supply security over cash reserves.
     */
    public getSupplySpendRatio(): number {
        return config.strategie.marketLeader.supplySpendRatio;
    }

    public zjistiDodavatele(
        firma: Firma,
        dodavatele: Dodavatel[],
        typSuroviny: TypSuroviny
    ): Dodavatel | null {
        const kandidati = dodavatele.filter(d => d.typSuroviny === typSuroviny);
        if (kandidati.length === 0) return null;

        // Prioritize closest supplier for supply chain control
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
