"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Timeline from "@/components/history/Timeline"
import KPIComparison from "@/components/history/KPIComparison"
import CompanyInfo from "@/components/history/CompanyInfo"
import Link from "next/link"
import { apiFetch } from "@/lib/api"

interface SimulationMetadata {
  id: string
  seed: string
  startedAt: number
  endedAt?: number
  finalTick: number
  companyCount: number
  buildingCount: number
  regionName: string
}

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

interface SerializedState {
  time: number
  tick: number
  summaries: {
    totalAgents: number
    avgTickDurationMs: number
  }
  logMetadata: {
    filePath: string
    eventCount: number
    note: string
  }
  region: {
    id: number
    nazev: string
  }
  agents: Array<{
    id: number
    name?: string
    nazev?: string
    constructor?: { name: string }
    KPI?: KPI
    finance?: number
    budovy?: Array<Record<string, unknown>>
    strategyVariant?: string
  }>
  buildings?: Array<Record<string, unknown>>
}

interface SnapshotData {
  tick: number
  timestamp: number
  state: SerializedState
}

export default function SimulationDetail() {
  const params = useParams()
  const simulationId = params.id as string

  const [metadata, setMetadata] = useState<SimulationMetadata | null>(null)
  const [availableTicks, setAvailableTicks] = useState<number[]>([])
  const [selectedTick, setSelectedTick] = useState<number | null>(3650)
  const [currentSnapshot, setCurrentSnapshot] = useState<SnapshotData | null>(null)
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch simulation detail
  useEffect(() => {
    const fetchDetail = async () => {
      try {
        const response = await apiFetch(`/history/${simulationId}`)
        if (!response.ok) {
          throw new Error(`Failed to fetch simulation detail: ${response.status}`)
        }
        const data = await response.json()
        setMetadata(data.metadata)
        console.log('Available ticks:', data.availableTicks)
        setAvailableTicks(data.availableTicks || [])
        // Set initial tick to the first available tick (not 0)
        if (data.availableTicks && data.availableTicks.length > 0) {
          const firstTick = data.availableTicks[data.availableTicks.length - 1]
          console.log('Setting initial tick to:', firstTick)
          setSelectedTick(firstTick)
        } else {
          setError('No snapshots available for this simulation')
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error"
        console.error('Error fetching detail:', errorMsg)
        setError(errorMsg)
      } finally {
        setLoading(false)
      }
    }

    fetchDetail()
  }, [simulationId])

  // Fetch snapshot for selected tick
  useEffect(() => {
    // Don't fetch if selectedTick hasn't been set yet
    if (!simulationId || selectedTick === null) {
      console.log('[Snapshot Fetch] Skipping - selectedTick is null')
      return
    }

    const fetchSnapshot = async () => {
      setSnapshotLoading(true)
      try {
        console.log(`[Snapshot Fetch] Fetching snapshot for tick: ${selectedTick}`)
        const response = await apiFetch(
          `/history/${simulationId}/snapshot/${selectedTick}`
        )
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          console.error('Failed to fetch snapshot:', {
            status: response.status,
            statusText: response.statusText,
            error: errorData
          })
          throw new Error(`Failed to fetch snapshot: ${response.status} ${response.statusText}`)
        }
        const data = await response.json()
        console.log(`[Snapshot Fetch] Successfully loaded snapshot for tick ${data.tick}`)
        setCurrentSnapshot(data)
      } catch (err) {
        console.error("Error fetching snapshot:", err)
        setError(err instanceof Error ? err.message : "Failed to load snapshot")
      } finally {
        setSnapshotLoading(false)
      }
    }

    fetchSnapshot()
  }, [simulationId, selectedTick])

  const companies = currentSnapshot?.state.agents
    .filter(agent => {
      // Log each agent for debugging
      console.log('[Company Filter] Agent:', {
        id: agent.id,
        constructor: agent.constructor?.name,
        hasKPI: !!agent.KPI,
        hasNazev: !!agent.nazev,
        type: typeof agent
      })
      return agent.KPI !== undefined && agent.KPI !== null
    })
    .map(agent => ({
      id: agent.id,
      name: agent.nazev || agent.name || `Company-${agent.id}`,
      strategy: agent.strategyVariant,
      KPI: agent.KPI,
      finance: agent.finance || 0,
      buildingsCount: agent.budovy?.length || 0,
    })) || []

  // Log snapshot data for debugging
  useEffect(() => {
    if (currentSnapshot) {
      console.log('[Snapshot Data]', {
        tick: currentSnapshot.tick,
        agentCount: currentSnapshot.state.agents?.length || 0,
        agentTypes: currentSnapshot.state.agents?.map(a => a.constructor?.name),
        companiesFound: companies.length,
      })
    }
  }, [currentSnapshot, companies.length])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-center">
          <div className="text-white text-xl mb-4">Načítám simulaci...</div>
          <div className="text-gray-400 text-sm">ID simulace: {simulationId.slice(0, 12)}...</div>
        </div>
      </div>
    )
  }

  if (error || !metadata) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-center max-w-md">
          <p className="text-red-400 text-xl mb-4">⚠️ {error || "Simulation not found"}</p>
          {error && <p className="text-gray-400 text-sm mb-6">{error}</p>}
          <Link
            href="/history"
            className="inline-block px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold"
          >
            ← Zpět na historii
          </Link>
        </div>
      </div>
    )
  }

  const buildingCount = currentSnapshot?.state.buildings?.length || 0

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-950 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-3xl font-bold">{metadata.regionName}</h1>
              <p className="text-gray-400 text-sm">Simulation {simulationId.slice(0, 12)}...</p>
            </div>
            <Link
              href="/history"
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg font-semibold transition-colors"
            >
              ← Zpět
            </Link>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <p className="text-gray-400">Finální tick</p>
              <p className="text-xl font-semibold">{metadata.finalTick}</p>
            </div>
            <div>
              <p className="text-gray-400">Firmy</p>
              <p className="text-xl font-semibold">{metadata.companyCount}</p>
            </div>
            <div>
              <p className="text-gray-400">Budovy</p>
              <p className="text-xl font-semibold">{buildingCount}</p>
            </div>
            <div>
              <p className="text-gray-400">Seed</p>
              <p className="text-xs font-mono truncate">{metadata.seed}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Sidebar - Companies */}
          <div className="lg:col-span-1">
            <div className="sticky top-32">
              <h3 className="text-lg font-semibold mb-4">Firmy</h3>
              {companies.length === 0 ? (
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-sm text-gray-400">
                  <p>Žádné firmy není možné načíst</p>
                  {currentSnapshot && (
                    <p className="text-xs mt-2 text-gray-500">
                      Agents: {currentSnapshot.state.agents?.length || 0}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {companies.map((company) => (
                    <CompanyInfo
                      key={company.id}
                      id={company.id}
                      name={company.name}
                      strategy={company.strategy}
                      finance={company.finance}
                      buildings={company.buildingsCount}
                      selectedCompanyId={selectedCompanyId}
                      onSelectCompany={setSelectedCompanyId}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Main Content - Timeline and KPIs */}
          <div className="lg:col-span-3 space-y-6">
            {/* Error display */}
            {error && (
              <div className="bg-red-900 border border-red-700 rounded-lg p-4 text-red-200">
                <p className="font-semibold">Error: {error}</p>
              </div>
            )}

            {/* Timeline */}
            {snapshotLoading && (
              <div className="bg-blue-900 border border-blue-700 rounded-lg p-4 text-blue-200">
                <p>Loading snapshot for tick {selectedTick}...</p>
              </div>
            )}
            <Timeline
              finalTick={metadata.finalTick}
              availableTicks={availableTicks}
              selectedTick={selectedTick}
              onTickSelect={setSelectedTick}
            />

            {/* KPI Comparison */}
            <div>
              <h3 className="text-lg font-semibold mb-4">
                {selectedCompanyId
                  ? `${companies.find(c => c.id === selectedCompanyId)?.name} – KPI`
                  : "Všechny firmy – KPI"}
              </h3>
              {snapshotLoading ? (
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 text-center">
                  <p className="text-gray-400">Načítám data...</p>
                </div>
              ) : companies.length > 0 ? (
                <KPIComparison
                  companies={companies}
                  selectedCompanyId={selectedCompanyId}
                />
              ) : (
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-4">
                  <p className="text-gray-400">No company data available</p>
                  {currentSnapshot && (
                    <div className="text-xs text-gray-500 bg-gray-900 p-3 rounded">
                      <p className="mb-2 font-semibold">Debug Info:</p>
                      <p>Total agents: {currentSnapshot.state.agents?.length || 0}</p>
                      <p>Agent types: {currentSnapshot.state.agents?.map(a => a.constructor?.name || 'unknown').join(', ') || 'none'}</p>
                      {currentSnapshot.state.agents && currentSnapshot.state.agents.length > 0 && (
                        <p>First agent keys: {Object.keys(currentSnapshot.state.agents[0]).slice(0, 5).join(', ')}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
