type FinalSummaryInput = {
    finalState: unknown
    recentLogs: unknown[]
}

type SummaryCompany = {
    id: string
    nazev: string
    strategyVariant: string
    finance: number
    production: number
    roi: number
    netProfit: number
    productionUtilization: number
    storageUtilization: number
}

type SummaryEvent = {
    tick?: number
    eventType?: string
    severity?: string
    companyId?: number | string
    agentId?: number
    payload?: Record<string, any>
}

function toNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return parsed
    }
    return 0
}

function getCompaniesFromFinalState(finalState: unknown): SummaryCompany[] {
    const root = (finalState ?? {}) as any
    const rawAgents = Array.isArray(root?.agents) ? root.agents : []

    return rawAgents
        .filter((agent: any) => {
            const hasCompanyLikeFields =
                typeof agent?.nazev === 'string' &&
                typeof agent?.KPI === 'object' &&
                agent?.KPI !== null
            return hasCompanyLikeFields
        })
        .map((agent: any) => {
            const kpi = (agent?.KPI ?? {}) as any
            const idRaw = agent?.id
            const id = typeof idRaw === 'number' || typeof idRaw === 'string' ? String(idRaw) : 'unknown'

            return {
                id,
                nazev: typeof agent?.nazev === 'string' ? agent.nazev : `Firma ${id}`,
                strategyVariant: typeof agent?.strategyVariant === 'string' ? agent.strategyVariant : 'UNKNOWN',
                finance: toNumber(agent?.finance),
                production: toNumber(agent?.produkce),
                roi: toNumber(kpi?.ROI),
                netProfit: toNumber(kpi?.cistyZisk),
                productionUtilization: toNumber(kpi?.miraVyuzitiVyrobniKapacity),
                storageUtilization: toNumber(kpi?.miraVyuzitiSkladovaciJednotky),
            }
        })
}

function summarizeState(finalState: unknown) {
    const state = (finalState ?? {}) as any
    const companies = getCompaniesFromFinalState(finalState)

    const topBy = (selector: (company: SummaryCompany) => number): SummaryCompany | null => {
        if (companies.length === 0) return null
        return companies.reduce((best, current) => selector(current) > selector(best) ? current : best)
    }

    return {
        tick: toNumber(state?.tick),
        seed: typeof state?.seed === 'string' ? state.seed : 'N/A',
        companyCount: companies.length,
        leaders: {
            byROI: topBy(c => c.roi)?.nazev ?? null,
            byNetProfit: topBy(c => c.netProfit)?.nazev ?? null,
            byProductionUtilization: topBy(c => c.productionUtilization)?.nazev ?? null,
            byStorageUtilization: topBy(c => c.storageUtilization)?.nazev ?? null,
        }
    }
}

function summarizeLogs(recentLogs: unknown[]) {
    const events = (Array.isArray(recentLogs) ? recentLogs : []) as SummaryEvent[]
    const eventTypeCounts: Record<string, number> = {}
    const severityCounts: Record<string, number> = {}
    const failedByCompany: Record<string, number> = {}

    for (const event of events) {
        const eventType = typeof event?.eventType === 'string' ? event.eventType : 'UNKNOWN'
        eventTypeCounts[eventType] = (eventTypeCounts[eventType] ?? 0) + 1

        const severity = typeof event?.severity === 'string' ? event.severity : 'info'
        severityCounts[severity] = (severityCounts[severity] ?? 0) + 1

        const eventLooksFailed = /FAILED|REJECTED|ERROR/.test(eventType)
        const companyId = event?.companyId
        if (eventLooksFailed && companyId !== undefined && companyId !== null) {
            const key = String(companyId)
            failedByCompany[key] = (failedByCompany[key] ?? 0) + 1
        }
    }

    const topEventTypes = Object.entries(eventTypeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([eventType, count]) => ({ eventType, count }))

    return {
        totalEvents: events.length,
        severityCounts,
        topEventTypes,
        failedByCompany,
    }
}

function formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`
}

function formatMoney(value: number): string {
    return `${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Kč`
}

function buildGeneralSummary(input: FinalSummaryInput): string {
    const companies = getCompaniesFromFinalState(input.finalState)
    const events = (Array.isArray(input.recentLogs) ? input.recentLogs : []) as SummaryEvent[]
    const totalFailures = events.filter(event => {
        const eventType = typeof event?.eventType === 'string' ? event.eventType : ''
        return /FAILED|REJECTED|ERROR/.test(eventType)
    }).length

    const stateSummary = summarizeState(input.finalState)
    const logsSummary = summarizeLogs(input.recentLogs)

    const lines: string[] = []
    lines.push('Obecné shrnutí simulace:')
    lines.push(`- Tick: ${stateSummary.tick}, firem: ${stateSummary.companyCount}, událostí v logu: ${logsSummary.totalEvents}.`)
    if (stateSummary.leaders.byROI) lines.push(`- Nejlepší ROI: ${stateSummary.leaders.byROI}.`)
    if (stateSummary.leaders.byNetProfit) lines.push(`- Nejvyšší čistý zisk: ${stateSummary.leaders.byNetProfit}.`)

    const negativeFinanceCompanies = companies.filter(company => company.finance < 0)
    const lowRoiCompanies = companies.filter(company => company.roi < 0)

    lines.push('')
    lines.push('Co se nepovedlo:')
    if (companies.length === 0) {
        lines.push('- Nelze vyhodnotit firmy, protože ve finálním stavu chybí data agentů.')
    } else {
        if (negativeFinanceCompanies.length > 0) {
            lines.push(`- ${negativeFinanceCompanies.length} firem skončilo v záporné finanční rezervě, což značí vysoké provozní zatížení nebo slabý prodej.`)
        } else {
            lines.push('- Žádná firma neskončila v záporné finanční rezervě.')
        }

        if (lowRoiCompanies.length > 0) {
            lines.push(`- ${lowRoiCompanies.length} firem má záporné ROI, investice se v daném běhu nevrátily.`)
        }

        lines.push(`- V logu bylo zaznamenáno ${totalFailures} problémových událostí (FAILED/REJECTED/ERROR).`)
    }

    lines.push('')
    lines.push('Co firmy udělaly dobře:')

    const companyEventsById: Record<string, SummaryEvent[]> = {}
    for (const event of events) {
        const companyId = event?.companyId
        if (companyId === undefined || companyId === null) continue
        const key = String(companyId)
        if (!companyEventsById[key]) companyEventsById[key] = []
        companyEventsById[key].push(event)
    }

    for (const company of companies) {
        const companyEvents = companyEventsById[company.id] ?? []
        const soldEvents = companyEvents.filter(event => event?.eventType === 'COMPANY_SOLD_PRODUCT')
        const expandedEvents = companyEvents.filter(event => event?.eventType === 'COMPANY_EXPANDED')
        const soldAmount = soldEvents.reduce((sum, event) => sum + toNumber(event?.payload?.amount), 0)

        const positives: string[] = []
        if (company.netProfit > 0) positives.push(`kladný čistý zisk ${formatMoney(company.netProfit)}`)
        if (company.roi > 0) positives.push(`kladné ROI ${formatPercent(company.roi)}`)
        if (company.productionUtilization > 0.7) positives.push(`vysoké využití výroby ${formatPercent(company.productionUtilization)}`)
        if (company.storageUtilization > 0.7) positives.push(`vysoké využití skladů ${formatPercent(company.storageUtilization)}`)
        if (company.finance > 0) positives.push(`pozitivní finanční rezerva ${formatMoney(company.finance)}`)
        if (soldAmount > 0) positives.push(`prodej ${Math.round(soldAmount)} jednotek`)
        if (expandedEvents.length > 0) positives.push(`expanze ${expandedEvents.length}x`)

        if (positives.length === 0) {
            positives.push('udržela provoz až do konce simulace')
        }

        lines.push(`- ${company.nazev}: ${positives.slice(0, 3).join(', ')}.`)
    }

    return lines.join('\n')
}

export async function generateSimulationFinalSummary(input: FinalSummaryInput): Promise<string> {
    return buildGeneralSummary(input)
}
