import { Firma } from './firma';
import { TypSuroviny } from './typSuroviny';

export type Objednavka = {
    firma: Firma,
    supplierId: number,
    objem: number,
    typSuroviny: TypSuroviny,
    cenaZaTunu: number,
    datumZadani: number, //Ticky
    datumOdeslani: number //ticky
}