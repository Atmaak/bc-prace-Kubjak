import { Strategie } from '../strategie';
import { Firma } from '../firma';
import { Dodavatel } from '../dodavatel';
import { TypSuroviny } from '../typSuroviny';
import { getGeoDistance } from '../../utils/distance';
import { SimulationEngine } from '../../simulation';
import { StrategyDecisionContext } from '../simulationEvent';
import config from '../../config.json';

// Ceny - ideálně by měly být z configu, zde pro simulaci rozhodování
const CENY = {
    BUDOVA: config.budova.purchaseCostEstimate,
    LINKA: config.linka.pocatecniCena,
    SKLAD: config.sklad.pocatecniCena
};

interface HodnocenyDodavatel {
    original: Dodavatel;
    vzdalenost: number;
    skore: number;
    cena: number;
}

interface MoznaAkce {
    nazev: string;
    typ: 'INVESTICE_BUDOVA' | 'INVESTICE_LINKA' | 'INVESTICE_SKLAD' | 'PRODEJ_OCEL';
    skore: number;      // 0.0 až 1.0
}

export class VyvazenaStrategie implements Strategie {
    private jmeno = "Vyvazena Strategie";

    // Váhy pro výběr dodavatele
    private w_cena: number;
    private w_vzdalenost: number;

    // Váhy pro strategické rozhodování
    private w_expanze: number;
    private w_cashflow: number;
    private w_bezpecnost: number;
    private w_logistika: number;

    constructor(
        w_cena: number = config.strategie.balanced.supplierWeights.price,
        w_vzdalenost: number = config.strategie.balanced.supplierWeights.distance,
        w_expanze: number = config.strategie.balanced.decisionWeights.expansion,
        w_cashflow: number = config.strategie.balanced.decisionWeights.cashflow,
        w_bezpecnost: number = config.strategie.balanced.decisionWeights.safety,
        w_logistika: number = config.strategie.balanced.decisionWeights.logistics
    ) {
        this.w_cena = w_cena;
        this.w_vzdalenost = w_vzdalenost;
        this.w_expanze = w_expanze;
        this.w_cashflow = w_cashflow;
        this.w_bezpecnost = w_bezpecnost;
        this.w_logistika = w_logistika;
    }

    public vykonejRozhodnuti(firma: Firma, tick: number, sim?: SimulationEngine): void {
        if (sim) {
            const logger = sim.getLogger()
            const suppliers = sim.getDodavatele();

            // Get max production capacity
            const maxCapacity = firma.getMaxProductionCapacity();
            
            // Balanced strategy: Produce at 70% capacity (balanced approach)
            const desiredProduction = Math.floor(maxCapacity * config.strategie.balanced.productionRate);

            // Moderate expansion cadence; when expanding, balance both lines and storage
            if (firma.shouldExpand() && tick % config.strategie.balanced.expandEveryTicks === 0) {
                firma.expandProduction(tick);
                firma.expandStorage(tick);
            }

            // Buy supplies dynamically based on current inventory and needs
            firma.buySuppliesDynamically(tick);

            // Produce at balanced capacity
            const produced = firma.produce(desiredProduction, tick);

            // Sell immediately after production
            if (produced > 0) {
                firma.sellProduct(produced, TypSuroviny.OCEL, tick);
            }

            logger.logEvent(
                logger.createEvent(tick, 'STRATEGY_DECISION_MADE', firma.id, {
                    strategyName: this.jmeno,
                    decision: 'BALANCED_PRODUCTION',
                    maxCapacity: maxCapacity,
                    desiredProduction: desiredProduction,
                    actuallyProduced: produced,
                    rationale: `Balanced approach - produce at ${(config.strategie.balanced.productionRate * 100).toFixed(0)}% capacity for stable operation`
                }, { companyId: firma.id, strategyId: this.jmeno })
            );
        }
    }

    private scoreDodavatel(dodavatel: Dodavatel, firma: Firma): number {
        const normCena = dodavatel.cena > 0
            ? Math.max(0, 1 - (dodavatel.cena / config.strategie.balanced.normalization.priceReference))
            : 0
        const normVzd = getGeoDistance(dodavatel.poloha, firma.poloha)
        const normDist = Math.max(0, 1 - (normVzd / config.strategie.balanced.normalization.distanceKmReference))
        return (normCena * this.w_cena) + (normDist * this.w_vzdalenost)
    }

    private realizujAkci(firma: Firma, akce: MoznaAkce) {
        // 1. ZJIŠTĚNÍ CENY PŘED PROVEDENÍM
        let pozadovanaCena = 0;

        switch (akce.typ) {
            case 'INVESTICE_BUDOVA': pozadovanaCena = CENY.BUDOVA; break;
            case 'INVESTICE_LINKA': pozadovanaCena = CENY.LINKA; break;
            case 'INVESTICE_SKLAD': pozadovanaCena = CENY.SKLAD; break;
            case 'PRODEJ_OCEL': pozadovanaCena = 0; break; // Prodej nic nestojí (generuje zisk)
        }

        // 2. SAFETY CHECK (GUARD CLAUSE)
        // Pokud firma nemá dost peněz, okamžitě končíme a nic neprovádíme.
        if (firma.finance < pozadovanaCena) {
            console.warn(`⚠️ [STRATEGIE BLOKOVÁNA] Firma ${firma.id} chtěla provést "${akce.nazev}", ale chybí finance. (Má: ${firma.finance}, Potřebuje: ${pozadovanaCena})`);
            return; // <--- TOTO JE KLÍČOVÉ: Ukončí funkci dříve, než se cokoliv stane
        }

        // 3. PROVEDENÍ AKCE (Pokud jsme prošli kontrolou)
        console.log(`✅ [STRATEGIE] Firma ${firma.id} provádí: ${akce.nazev}`);
        
        switch (akce.typ) {
            case 'INVESTICE_BUDOVA':
                firma.koupitBudovu(); 
                break;
            case 'INVESTICE_LINKA':
                firma.koupitLinku(); 
                break;
            case 'INVESTICE_SKLAD':
                firma.koupitSklad(); 
                break;
            case 'PRODEJ_OCEL':
                console.log("-> Ocel prodána (Simulace)");
                break;
        }
    }

    /**
     * Balanced strategy spends at most 25 % of current finances on supplies
     * per tick – moderate risk, stable operation.
     */
    public getSupplySpendRatio(): number {
        return config.strategie.balanced.supplySpendRatio;
    }

    public zjistiDodavatele(
        firma: Firma, 
        dodavatele: Dodavatel[],
        typSuroviny: TypSuroviny
    ): Dodavatel | null {
        const kandidati = dodavatele.filter((d: Dodavatel) => 
            d.typSuroviny === typSuroviny
        );

        if (kandidati.length === 0) return null;
       
        let ohodnoceni: HodnocenyDodavatel[] = kandidati.map(d => {
            return {
                original: d,
                vzdalenost: getGeoDistance(d.poloha, firma.poloha),
                skore: 0,
                cena: d.cena
            };
        });

        const maxCena = Math.max(...ohodnoceni.map(h => h.original.cena));
        const minCena = Math.min(...ohodnoceni.map(h => h.original.cena));
        const maxVzd = Math.max(...ohodnoceni.map(h => h.vzdalenost));
        const minVzd = Math.min(...ohodnoceni.map(h => h.vzdalenost));

        const rozptylCena = maxCena - minCena || 1; 
        const rozptylVzd = maxVzd - minVzd || 1;

        ohodnoceni.forEach(h => {
            const normCena = 1 - ((h.original.cena - minCena) / rozptylCena);
            const normVzd = 1 - ((h.vzdalenost - minVzd) / rozptylVzd);
            h.skore = (normCena * this.w_cena) + (normVzd * this.w_vzdalenost);
        });

        ohodnoceni.sort((a, b) => b.skore - a.skore);
        return ohodnoceni[0]?.original ? ohodnoceni[0]?.original : null;
    }
}