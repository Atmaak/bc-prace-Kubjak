"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"
import {
  CompanyDashboardDTO,
  SimulationMessageData,
  normalizeCompanyForDashboard,
} from "@/lib/types"

type Company = CompanyDashboardDTO

type SimulationState = {
  tick: number
  firmy: Company[]
  dodavatele?: unknown[]
}

type CompanyDashboardProps = {
  socket: WebSocket
  initialData?: SimulationMessageData | null
}

function extractSimulationState(data: SimulationMessageData | null | undefined): SimulationState | null {
  if (!data || data.tick === undefined) return null

  const firmy = data.agents?.map(normalizeCompanyForDashboard).filter((agent): agent is Company => agent !== null) || []

  const dodavatele = data.agents?.filter((agent) => normalizeCompanyForDashboard(agent) === null)

  if (firmy.length === 0) return null

  return {
    tick: data.tick,
    firmy,
    dodavatele
  }
}

export default function CompanyDashboard({ socket, initialData }: CompanyDashboardProps) {
  const [simulationState, setSimulationState] = useState<SimulationState | null>(
    extractSimulationState(initialData)
  )
  const [expandedCompany, setExpandedCompany] = useState<string | number | null>(null)
  const [updatingCompanyId, setUpdatingCompanyId] = useState<string | number | null>(null)

  const updateCompanyOperations = async (
    companyId: string | number,
    update: { productionEnabled?: boolean; storageEnabled?: boolean }
  ) => {
    setUpdatingCompanyId(companyId)
    try {
      const response = await apiFetch(`/controls/company/${companyId}/operations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(update)
      })

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`)
      }

      const result = await response.json()
      const nextMode = result?.operationsMode

      if (nextMode) {
        setSimulationState((prev) => {
          if (!prev) return prev

          return {
            ...prev,
            firmy: prev.firmy.map((firma) =>
              firma.id === companyId
                ? {
                    ...firma,
                    operationsMode: {
                      productionEnabled: Boolean(nextMode.productionEnabled),
                      storageEnabled: Boolean(nextMode.storageEnabled)
                    }
                  }
                : firma
            )
          }
        })
      }
    } catch (error) {
      console.error("Failed to update company operations:", error)
    } finally {
      setUpdatingCompanyId(null)
    }
  }

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
      <div className="bg-gray-800 text-white p-4 rounded-lg">
        <h2 className="text-xl font-bold mb-2">Firmy</h2>
        <p className="text-gray-400">Čekám na data simulace...</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-800 text-white p-4 rounded-lg h-full overflow-y-auto">
      <div className="mb-4">
        <h2 className="text-xl font-bold">Přehled firem</h2>
        <p className="text-gray-400 text-sm">Tick: {simulationState.tick}</p>
      </div>

      <div className="space-y-3">
        {simulationState.firmy.map((company) => (
          <div
            key={company.id}
            className="bg-gray-900 rounded-lg p-3 border border-gray-700 hover:border-gray-500 transition-colors"
          >
            <div
              className="cursor-pointer"
              onClick={() =>
                setExpandedCompany(
                  expandedCompany === company.id ? null : company.id
                )
              }
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-lg">{company.nazev}</h3>
                  <span
                    className="text-xs px-2 py-1 rounded text-white font-semibold"
                  >
                    {company.strategyVariant}
                  </span>
                </div>
                <span className="text-green-400 font-bold">
                  {company.finance.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Kč
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-gray-400">KOKS:</span>{" "}
                  <span className="text-white font-semibold">
                    {company.zasoby.KOKS.mnozstvi.toFixed(1)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">RUDA:</span>{" "}
                  <span className="text-white font-semibold">
                    {company.zasoby.ZELEZNA_RUDA.mnozstvi.toFixed(1)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Produkce:</span>{" "}
                  <span className="text-white font-semibold">
                    {company.produkce.toFixed(1)}
                  </span>
                </div>
              </div>
            </div>

            {expandedCompany === company.id && (
              <div className="mt-3 pt-3 border-t border-gray-700 text-sm space-y-1">
                <div>
                  <span className="text-gray-400">Budovy:</span>{" "}
                  <span className="text-white">{company.budovy.length}</span>
                </div>
                <div>
                  <span className="text-gray-400">Výrobní linky:</span>{" "}
                  <span className="text-white">{company.linky.length}</span>
                </div>
                <div>
                  <span className="text-gray-400">Sklady:</span>{" "}
                  <span className="text-white">{company.sklady.length}</span>
                </div>
                <div className="pt-2 border-t border-gray-700 mt-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-400">Výroba</span>
                    <button
                      disabled={updatingCompanyId === company.id}
                      onClick={() =>
                        updateCompanyOperations(company.id, {
                          productionEnabled: !(company.operationsMode?.productionEnabled ?? true)
                        })
                      }
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        (company.operationsMode?.productionEnabled ?? true)
                          ? "bg-green-700 text-white"
                          : "bg-red-700 text-white"
                      } ${updatingCompanyId === company.id ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {(company.operationsMode?.productionEnabled ?? true) ? "ON" : "OFF"}
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <span className="text-gray-400">Sklad</span>
                    <button
                      disabled={updatingCompanyId === company.id}
                      onClick={() =>
                        updateCompanyOperations(company.id, {
                          storageEnabled: !(company.operationsMode?.storageEnabled ?? true)
                        })
                      }
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        (company.operationsMode?.storageEnabled ?? true)
                          ? "bg-green-700 text-white"
                          : "bg-red-700 text-white"
                      } ${updatingCompanyId === company.id ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {(company.operationsMode?.storageEnabled ?? true) ? "ON" : "OFF"}
                    </button>
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  Klikněte pro sbalení
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
