# KPI metodika

## Obecná pravidla interpretace

- KPI porovnáváme mezi strategiemi na stejné sadě seedů.
- Izolované výsledky z jednoho běhu se nepovažují za finální závěr.
- Hlavní rozhodování je dle průměru, SD a 95% CI.

## Definice KPI

- `ROI` – návratnost investic; vyšší je lepší.
- `cistyZisk` – čistý zisk firmy; vyšší je lepší.
- `celkovaInvestice` – celkový objem investic; kontextová metrika.
- `financniRezerva` – hotovostní rezerva; vyšší je bezpečnější.
- `likviditniKrytiProvozu` – kolik provozních období firma pokryje rezervou; vyšší je lepší.
- `miraVyuzitiVyrobniKapacity` – využití linek; vyšší je typicky lepší.
- `miraVyuzitiSkladovaciJednotky` – využití skladů; příliš vysoká hodnota může znamenat přetížení.
- `spotrebaEnergie` – energetická náročnost; nižší je lepší.
- `miraNesplnenePoptavky` – podíl neuspokojené poptávky; nižší je lepší.
- `prumernaDobaCekaniSurovin` – průměrná čekací doba na vstupy; nižší je lepší.
- `provozniMarze` – provozní marže; vyšší je lepší.
- `nakladovostTrzeb` – nákladovost vůči tržbám; nižší je lepší.
- `uspesnostPlneniObjednavek` – míra splněných objednávek; vyšší je lepší.

## Ranking pravidla

- „Lower is better“: `miraNesplnenePoptavky`, `prumernaDobaCekaniSurovin`, `nakladovostTrzeb`, `spotrebaEnergie`.
- Ostatní KPI: vyšší je lepší.

## Vazba na hypotézy

Příklad mapování KPI → hypotéza:

- Stabilita strategie: `likviditniKrytiProvozu`, `financniRezerva`
- Růst strategie: `ROI`, `cistyZisk`, `provozniMarze`
- Tržní obsluha: `uspesnostPlneniObjednavek`, `miraNesplnenePoptavky`
- Provozní efektivita: `nakladovostTrzeb`, `spotrebaEnergie`, `prumernaDobaCekaniSurovin`

V textu práce vždy uvést:

1. kterou hypotézu KPI testuje,
2. které směry jsou „lepší“,
3. zda rozdíl potvrzuje i 95% CI.
