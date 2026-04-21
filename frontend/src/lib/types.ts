export type KPI = {
  celkovaInvestice: number
  cistyZisk: number
  financniRezerva: number
  likviditniKrytiProvozu: number
  miraNesplnenePoptavky: number
  nakladovostTrzeb: number
  provozniMarze: number
  miraVyuzitiSkladovaciJednotky: number
  miraVyuzitiVyrobniKapacity: number
  prumernaDobaCekaniSurovin: number
  ROI: number
  spotrebaEnergie: number
  uspesnostPlneniObjednavek: number
}

export type CompanyKpiDTO = {
  id: string | number
  nazev: string
  strategyVariant: string
  finance: number
  KPI: KPI
}

export type CompanyDashboardDTO = {
  id: string | number
  nazev: string
  strategyVariant: string
  finance: number
  zasoby: {
    KOKS: { mnozstvi: number }
    ZELEZNA_RUDA: { mnozstvi: number }
  }
  budovy: unknown[]
  linky: unknown[]
  sklady: unknown[]
  produkce: number
  operationsMode?: {
    productionEnabled: boolean
    storageEnabled: boolean
  }
}

export type SimulationMessageData = {
  tick?: number
  seed?: string
  agents?: unknown[]
  running?: boolean
  finished?: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null
}

export function isKPI(candidate: unknown): candidate is KPI {
  if (!isRecord(candidate)) return false
  return typeof candidate.ROI === "number" && typeof candidate.cistyZisk === "number"
}

export function normalizeCompanyForKpi(agent: unknown): CompanyKpiDTO | null {
  if (!isRecord(agent)) return null
  const kpiCandidate = agent.KPI ?? agent.kpi
  if (!isKPI(kpiCandidate)) return null

  return {
    id: typeof agent.id === "string" || typeof agent.id === "number" ? agent.id : "unknown",
    nazev: typeof agent.nazev === "string" ? agent.nazev : "Unknown Company",
    strategyVariant: typeof agent.strategyVariant === "string" ? agent.strategyVariant : "UNKNOWN",
    finance: typeof agent.finance === "number" ? agent.finance : 0,
    KPI: kpiCandidate
  }
}

export function normalizeCompanyForDashboard(agent: unknown): CompanyDashboardDTO | null {
  if (!isRecord(agent)) return null
  if (!Array.isArray(agent.budovy)) return null

  const zasobyRecord = isRecord(agent.zasoby) ? agent.zasoby : {}
  const koks = isRecord(zasobyRecord.KOKS) ? zasobyRecord.KOKS : { mnozstvi: 0 }
  const ruda = isRecord(zasobyRecord.ZELEZNA_RUDA) ? zasobyRecord.ZELEZNA_RUDA : { mnozstvi: 0 }
  const operationsMode = isRecord(agent.operationsMode) ? agent.operationsMode : undefined

  return {
    id: typeof agent.id === "string" || typeof agent.id === "number" ? agent.id : "unknown",
    nazev: typeof agent.nazev === "string" ? agent.nazev : "Unknown Company",
    strategyVariant: typeof agent.strategyVariant === "string" ? agent.strategyVariant : "UNKNOWN",
    finance: typeof agent.finance === "number" ? agent.finance : 0,
    zasoby: {
      KOKS: { mnozstvi: typeof koks.mnozstvi === "number" ? koks.mnozstvi : 0 },
      ZELEZNA_RUDA: { mnozstvi: typeof ruda.mnozstvi === "number" ? ruda.mnozstvi : 0 }
    },
    budovy: agent.budovy,
    linky: Array.isArray(agent.linky) ? agent.linky : [],
    sklady: Array.isArray(agent.sklady) ? agent.sklady : [],
    produkce: typeof agent.produkce === "number" ? agent.produkce : 0,
    operationsMode: operationsMode ? {
      productionEnabled: Boolean(operationsMode.productionEnabled),
      storageEnabled: Boolean(operationsMode.storageEnabled)
    } : undefined
  }
}
