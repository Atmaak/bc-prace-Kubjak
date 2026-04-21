import { Firma } from "./firma"
import { Dodavatel } from './dodavatel';
import { TypSuroviny } from './typSuroviny';
import { SimulationEngine } from '../simulation';

export interface Strategie {
	vykonejRozhodnuti(firma: Firma, tick: number, sim?: SimulationEngine): void
	zjistiDodavatele(firma: Firma, dodavatele: Dodavatel[], typSuroviny: TypSuroviny ): Dodavatel | null
	/**
	 * Returns the fraction of current finances the strategy is willing to spend
	 * on raw material purchases in a single tick (0.0 – 1.0).
	 * Higher = more aggressive spending; lower = more conservative.
	 */
	getSupplySpendRatio(): number
}
