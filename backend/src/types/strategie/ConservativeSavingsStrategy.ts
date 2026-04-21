import { Strategie } from '../strategie';
import { Firma } from '../firma';
import { Dodavatel } from '../dodavatel';
import { TypSuroviny } from '../typSuroviny';
import { getGeoDistance } from '../../utils/distance';
import { SimulationEngine } from '../../simulation';
import config from '../../config.json';

/**
 * Conservative Savings Strategy
 * Focuses on minimizing costs and preserving capital reserves
 * Orders minimal quantities, prioritizes lowest price
 */
export class ConservativeSavingsStrategy implements Strategie {
    private jmeno = "Conservative Savings Strategy";
    private w_cena: number = config.strategie.conservative.supplierWeights.price;
    private w_vzdalenost: number = config.strategie.conservative.supplierWeights.distance;

    public vykonejRozhodnuti(firma: Firma, tick: number, sim?: SimulationEngine): void {
        if (sim) {
            const logger = sim.getLogger();
            const suppliers = sim.getDodavatele();

            // Get max production capacity
            const maxCapacity = firma.getMaxProductionCapacity();
            
            // Conservative strategy: Produce at 50% capacity to save costs
            const desiredProduction = Math.floor(maxCapacity * config.strategie.conservative.productionRate);

            // Minimal expansion cadence; when expanding, keep line/storage balanced
            if (firma.shouldExpand() && tick % config.strategie.conservative.expandEveryTicks === 0) {
                firma.expandProduction(tick);
                firma.expandStorage(tick);
            }

            // Buy supplies dynamically based on current inventory and needs
            firma.buySuppliesDynamically(tick);

            // Produce conservatively
            const produced = firma.produce(desiredProduction, tick);

            // Sell immediately after production
            if (produced > 0) {
                firma.sellProduct(produced, TypSuroviny.OCEL, tick);
            }

            logger.logEvent(
                logger.createEvent(tick, 'STRATEGY_DECISION_MADE', firma.id, {
                    strategyName: this.jmeno,
                    decision: 'CONSERVATIVE_PRODUCTION',
                    maxCapacity: maxCapacity,
                    desiredProduction: desiredProduction,
                    actuallyProduced: produced,
                    rationale: 'Minimize risk - produce at 50% capacity to preserve cash reserves'
                }, { companyId: firma.id, strategyId: this.jmeno })
            );
        }
    }

    /**
     * Conservative strategy spends at most 15 % of current finances on supplies
     * per tick – preserves capital and avoids cash-flow crises.
     */
    public getSupplySpendRatio(): number {
        return config.strategie.conservative.supplySpendRatio;
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
