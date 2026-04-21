"use client"

import { useMemo } from "react"

interface KPI {
  celkovaInvestice: number
  cistyZisk: number
  financniRezerva: number
  miraNesplnenePoptavky: number
  miraVyuzitiSkladovaciJednotky: number
  miraVyuzitiVyrobniKapacity: number
  prumernaDobaCekaniSurovin: number
  ROI: number
  spotrebaEnergie: number
}

interface CompanyData {
  id: number
  name: string
  KPI: KPI | undefined
  finance: number
  strategy?: string
  buildingsCount: number
}

interface KPIComparisonProps {
  companies: CompanyData[]
  selectedCompanyId?: number
}

const KPI_METRICS = [
  { key: "ROI", label: "ROI", unit: "%", format: (v: number) => v.toFixed(1) },
  { key: "cistyZisk", label: "Čistý zisk", unit: "Kč", format: (v: number) => (v / 1000).toFixed(1) + "K" },
  { key: "celkovaInvestice", label: "Celková investice", unit: "Kč", format: (v: number) => (v / 1000).toFixed(1) + "K" },
  { key: "financniRezerva", label: "Finanční rezerva", unit: "Kč", format: (v: number) => (v / 1000).toFixed(1) + "K" },
  { key: "miraVyuzitiVyrobniKapacity", label: "Využití výrobní kapacity", unit: "%", format: (v: number) => v.toFixed(1) },
  { key: "miraVyuzitiSkladovaciJednotky", label: "Využití skladové kapacity", unit: "%", format: (v: number) => v.toFixed(1) },
  { key: "spotrebaEnergie", label: "Spotřeba energie", unit: "kWh", format: (v: number) => (v / 1000).toFixed(1) + "K" },
  { key: "miraNesplnenePoptavky", label: "Míra nesplněné poptávky", unit: "%", format: (v: number) => v.toFixed(1) },
  { key: "prumernaDobaCekaniSurovin", label: "Prům. doba čekání surovin", unit: "dnů", format: (v: number) => v.toFixed(1) },
] as const

export default function KPIComparison({ companies, selectedCompanyId }: KPIComparisonProps) {
  const displayCompanies = useMemo(() => {
    if (selectedCompanyId !== undefined) {
      return companies.filter(c => c.id === selectedCompanyId)
    }
    return companies
  }, [companies, selectedCompanyId])

  const getMaxValue = (metricKey: string) => {
    return Math.max(
      ...displayCompanies
        .filter(c => c.KPI !== undefined)
        .map(c => (c.KPI![metricKey as keyof KPI] as number) || 0)
    )
  }

  const getBarWidth = (value: number, maxValue: number) => {
    return (value / maxValue) * 100
  }

  if (displayCompanies.length === 0) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <p className="text-gray-400">Žádná data firem nejsou k dispozici</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {KPI_METRICS.map(({ key, label, unit, format }) => {
        const maxValue = getMaxValue(key)

        return (
          <div key={key} className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <div className="flex justify-between items-center mb-3">
              <h4 className="font-semibold">{label}</h4>
              <span className="text-gray-400 text-sm">{unit}</span>
            </div>

            <div className="space-y-2">
              {displayCompanies.map((company) => {
                if (!company.KPI) return null
                const value = company.KPI[key as keyof KPI] as number
                const percentage = getBarWidth(value, maxValue)

                return (
                  <div key={company.id}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm">{company.name}</span>
                      <span className="text-xs font-mono bg-gray-900 px-2 py-1 rounded">
                        {format(value)}
                      </span>
                    </div>
                    <div className="h-6 bg-gray-900 border border-gray-600 rounded overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-300"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
