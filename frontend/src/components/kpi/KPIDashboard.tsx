"use client"

import { useEffect, useState } from "react"
import {
  KPI,
  SimulationMessageData,
  CompanyKpiDTO,
  normalizeCompanyForKpi,
} from "@/lib/types"

type Company = CompanyKpiDTO

type SimulationState = {
  tick: number
  firmy: Company[]
}

type KpiMetricDef = {
  key: keyof KPI
  label: string
  format: "currency" | "percent" | "number"
  decimals?: number
  isLowerBetter?: boolean
}

const KPI_METRICS: KpiMetricDef[] = [
  { key: "ROI", label: "ROI", format: "percent" },
  { key: "cistyZisk", label: "Čistý zisk", format: "currency" },
  { key: "celkovaInvestice", label: "Celková investice", format: "currency" },
  { key: "financniRezerva", label: "Finanční rezerva", format: "currency" },
  { key: "provozniMarze", label: "Provozní marže", format: "percent" },
  { key: "nakladovostTrzeb", label: "Nákladovost tržeb", format: "percent", isLowerBetter: true },
  { key: "likviditniKrytiProvozu", label: "Likviditní krytí provozu", format: "number", decimals: 1 },
  { key: "miraVyuzitiVyrobniKapacity", label: "Využití výrobní kapacity", format: "percent" },
  { key: "miraVyuzitiSkladovaciJednotky", label: "Využití skladové kapacity", format: "percent" },
  { key: "uspesnostPlneniObjednavek", label: "Úspěšnost plnění objednávek", format: "percent" },
  { key: "miraNesplnenePoptavky", label: "Míra nesplněné poptávky", format: "percent", isLowerBetter: true },
  { key: "prumernaDobaCekaniSurovin", label: "Prům. doba čekání surovin", format: "number", decimals: 1, isLowerBetter: true },
  { key: "spotrebaEnergie", label: "Spotřeba energie", format: "number", decimals: 0, isLowerBetter: true }
]

type KPIDashboardProps = {
  socket: WebSocket
  initialData?: SimulationMessageData | null
}

function extractSimulationState(data: SimulationMessageData | null | undefined): SimulationState | null {
  if (!data || data.tick === undefined) return null

  const firmy = data.agents?.map(normalizeCompanyForKpi).filter((company): company is Company => company !== null) || []
  if (firmy.length === 0) return null

  return {
    tick: data.tick,
    firmy
  }
}

export default function KPIDashboard({ socket, initialData }: KPIDashboardProps) {
  const [simulationState, setSimulationState] = useState<SimulationState | null>(
    extractSimulationState(initialData)
  )
  const [sortBy, setSortBy] = useState<keyof KPI>("ROI")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data)
        // Handle the nested structure from backend: { type: "state", data: { tick, agents, ... } }
        if (message.type === "state" && message.data) {
          const nextState = extractSimulationState(message.data as SimulationMessageData)
          if (nextState) {
            setSimulationState(nextState)
          }
        }
      } catch (e) {
        console.error("Failed to parse simulation state:", e)
      }
    }

    socket.addEventListener("message", handleMessage)
    return () => {
      socket.removeEventListener("message", handleMessage)
    }
  }, [socket])

  if (!simulationState) {
    return (
      <div className="bg-gray-800 text-white p-8 rounded-lg text-center">
        <h2 className="text-2xl font-bold mb-4">Přehled KPI společností</h2>
        <p className="text-gray-400">Čekám na data simulace...</p>
      </div>
    )
  }

  const getStrategyColor = (strategy: string) => {
    switch (strategy) {
      case "BALANCED":
        return "bg-blue-600"
      case "AGGRESSIVE":
        return "bg-red-600"
      case "CONSERVATIVE":
        return "bg-green-600"
      case "MARKET_LEADER":
        return "bg-purple-600"
      case "ADAPTIVE":
        return "bg-yellow-600"
      default:
        return "bg-gray-600"
    }
  }

  const getKpiValue = (company: Company, key: keyof KPI): number => {
    const value = company.KPI[key]
    return Number.isFinite(value) ? value : 0
  }

  const sortedCompanies = [...simulationState.firmy].sort((a, b) => {
    const aValue = getKpiValue(a, sortBy)
    const bValue = getKpiValue(b, sortBy)
    return sortOrder === "desc" ? bValue - aValue : aValue - bValue
  })

  const getBestValue = (kpiKey: keyof KPI, isLowerBetter = false) => {
    const values = simulationState.firmy.map((c) => getKpiValue(c, kpiKey))
    return isLowerBetter ? Math.min(...values) : Math.max(...values)
  }

  const isTopPerformer = (company: Company, kpiKey: keyof KPI, isLowerBetter = false) => {
    const bestValue = getBestValue(kpiKey, isLowerBetter)
    return getKpiValue(company, kpiKey) === bestValue
  }

  const formatNumber = (num: number, decimals = 1) => {
    const fixed = num.toFixed(decimals)
    const [integer, decimal] = fixed.split('.')
    const withSpaces = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
    return decimal ? `${withSpaces}.${decimal}` : withSpaces
  }

  const formatCurrency = (num: number) => {
    return `${formatNumber(num, 0)} Kč`
  }

  const formatPercent = (num: number) => {
    return `${(num * 100).toFixed(1)}%`
  }

  const formatMetricValue = (value: number, metric: KpiMetricDef) => {
    if (metric.format === "currency") {
      return formatCurrency(value)
    }
    if (metric.format === "percent") {
      return formatPercent(value)
    }
    return formatNumber(value, metric.decimals ?? 1)
  }

  const handleSort = (kpiKey: keyof KPI) => {
    if (sortBy === kpiKey) {
      setSortOrder(sortOrder === "desc" ? "asc" : "desc")
    } else {
      const metricDef = KPI_METRICS.find((metric) => metric.key === kpiKey)
      setSortBy(kpiKey)
      setSortOrder(metricDef?.isLowerBetter ? "asc" : "desc")
    }
  }

  const SortIcon = ({ isActive, order }: { isActive: boolean; order: "asc" | "desc" }) => {
    if (!isActive) return <span className="text-gray-600">⇅</span>
    return order === "desc" ? <span className="text-blue-400">↓</span> : <span className="text-blue-400">↑</span>
  }

  return (
    <div className="bg-gray-800 text-white p-6 rounded-lg h-full overflow-y-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold mb-2">Přehled KPI firem</h2>
        <div className="flex items-center justify-between">
          <p className="text-gray-400">Tick: {simulationState.tick}</p>
          <p className="text-sm text-gray-400">
            Klikněte na záhlaví sloupce pro řazení • 🏆 = Nejlepší
          </p>
        </div>
      </div>

      {/* Company Cards for Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {sortedCompanies.map((company) => (
          <div
            key={company.id}
            className="bg-gray-900 rounded-lg p-4 border border-gray-700"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-lg">{company.nazev}</h3>
              <span
                className={`${getStrategyColor(
                  company.strategyVariant
                )} text-xs px-2 py-1 rounded`}
              >
                {company.strategyVariant}
              </span>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Finance:</span>
                <span className="text-green-400 font-semibold">
                  {formatCurrency(company.finance)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">ROI:</span>
                <span className={isTopPerformer(company, "ROI") ? "text-yellow-400 font-bold" : "text-white"}>
                  {formatPercent(getKpiValue(company, "ROI"))}
                  {isTopPerformer(company, "ROI") && " \ud83c\udfc6"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Čistý zisk:</span>
                <span className={isTopPerformer(company, "cistyZisk") ? "text-yellow-400 font-bold" : "text-white"}>
                  {formatCurrency(getKpiValue(company, "cistyZisk"))}
                  {isTopPerformer(company, "cistyZisk") && " \ud83c\udfc6"}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Detailed KPI Table */}
      <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
        <h3 className="text-xl font-bold mb-4">Detailní porovnání KPI</h3>
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-gray-700 sticky top-0 bg-gray-900 z-10">
              <th className="text-left p-2 font-semibold">Strategie</th>
              {KPI_METRICS.map((metric) => (
                <th
                  key={metric.key}
                  className="text-right p-2 font-semibold cursor-pointer hover:bg-gray-800"
                  onClick={() => handleSort(metric.key)}
                >
                  {metric.label} <SortIcon isActive={sortBy === metric.key} order={sortOrder} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedCompanies.map((company, index) => (
              <tr
                key={company.id}
                className={`border-b border-gray-800 ${
                  index % 2 === 0 ? "bg-gray-900" : "bg-gray-850"
                } hover:bg-gray-800`}
              >
                <td className="p-2">
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold text-sm text-white">{company.nazev}</span>
                    <span
                      className={`${getStrategyColor(
                        company.strategyVariant
                      )} text-xs px-2 py-1 rounded w-fit`}
                    >
                      {company.strategyVariant}
                    </span>
                  </div>
                </td>
                {KPI_METRICS.map((metric) => {
                  const value = getKpiValue(company, metric.key)
                  const top = isTopPerformer(company, metric.key, metric.isLowerBetter)
                  return (
                    <td key={metric.key} className={`p-2 text-right ${top ? "text-yellow-400 font-bold" : ""}`}>
                      {formatMetricValue(value, metric)}
                      {top && " 🏆"}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Additional KPIs */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-900 rounded-lg p-4">
          <h3 className="text-lg font-bold mb-3">Provozní efektivita</h3>
          <div className="space-y-2">
            {sortedCompanies.map((company) => (
              <div key={company.id} className="flex justify-between items-center">
                <span className="text-sm">{company.nazev}</span>
                <div className="flex gap-4 text-sm">
                  <span className="text-gray-400">
                    D. čekání surovin: {formatNumber(getKpiValue(company, "prumernaDobaCekaniSurovin"), 1)} ticků
                  </span>
                  <span className="text-gray-400">
                    Nesplněná poptávka: {formatPercent(getKpiValue(company, "miraNesplnenePoptavky"))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-900 rounded-lg p-4">
          <h3 className="text-lg font-bold mb-3">Finanční zdraví</h3>
          <div className="space-y-2">
            {sortedCompanies.map((company) => (
              <div key={company.id} className="flex justify-between items-center">
                <span className="text-sm">{company.nazev}</span>
                <div className="text-sm">
                  <span className="text-green-400 font-semibold">
                    {formatCurrency(company.finance)}
                  </span>
                  <span className="text-gray-400 ml-2">
                    (Rezerva: {formatCurrency(getKpiValue(company, "financniRezerva"))})
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
