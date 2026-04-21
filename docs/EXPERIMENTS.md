# Experimentální protokol

## Cíl

Porovnat strategie firem za stejných scénářových podmínek a statisticky vyhodnotit výkon.

## Princip opakovatelnosti

- Každý běh používá deterministický seed.
- Všechny strategie běží ve stejném scénáři (stejná konfigurace regionu, firem, trhu).
- Experiment runner používá minimálně 10 běhů na strategii (`runsPerStrategy >= 10`).

## Implementace

- `backend/src/services/experimentRunner.ts`
- `backend/src/services/statistics.ts`
- `backend/src/scripts/runExperiments.ts`

## Výstupní metriky

Pro každý KPI a strategii se počítá:

- průměr
- směrodatná odchylka (sample SD)
- 95% interval spolehlivosti
- pořadí (ranking) mezi strategiemi

## Výstupní data

Výsledky se ukládají do:

- `backend/simulation-history/experiments/experiment-*.json`

Soubor obsahuje:

- konfiguraci experimentu (`runsPerStrategy`, `tickCount`, `seedPrefix`)
- použité seedy
- agregace po KPI (`metrics[]`)
- přímé srovnání `aiVsStatic` (kolik KPI vyhrály AI strategie vs. statické)
- detail po bězích (`perRun[]`)

## Doporučený postup pro BP

1. Fixovat konfiguraci scénáře v `backend/src/config.json`.
2. Spustit experiment minimálně s 10 běhy na strategii.
3. Uložit výstupní JSON jako přílohu.
4. Interpretovat KPI podle metodiky v `docs/KPI_METHODIKA.md`.
5. Při změně modelu trhu spustit experiment znovu se stejnou sadou seedů.
