"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import { apiFetch, API_CONFIG } from "@/lib/api"

// ─── Types ─────────────────────────────────────────────────────────────────

type NumericSummary = {
  mean: number
  standardDeviation: number
  ci95Low: number
  ci95High: number
  sampleSize: number
}

type StrategyMetricResult = NumericSummary & {
  strategyVariant: string
  rank: number
  values: number[]
}

type ExperimentMetricResult = {
  metric: string
  lowerIsBetter: boolean
  strategies: StrategyMetricResult[]
}

type AiVsStaticOutcome = {
  metric: string
  lowerIsBetter: boolean
  winner: "AI" | "STATIC" | "TIE"
  aiBestStrategy: string
  aiBestMean: number
  staticBestStrategy: string
  staticBestMean: number
}

type ExperimentResult = {
  experimentId: string
  generatedAt: string
  config: {
    runsPerStrategy: number
    tickCount: number
    seedPrefix: string
    adaptiveCarryoverLearning: boolean
  }
  seeds: string[]
  metrics: ExperimentMetricResult[]
  perRun: Array<{
    seed: string
    tickCount: number
    companies: Array<{
      companyId: number
      companyName: string
      strategyVariant: string
      kpi: Record<string, number>
    }>
  }>
  aiVsStatic: {
    evaluatedMetrics: number
    aiWins: number
    staticWins: number
    ties: number
    aiWinRate: number
    metricOutcomes: AiVsStaticOutcome[]
  }
  objectiveSummary: {
    objectiveMetric: string
    winnerStrategy: string
    winnerGroup: string
    winnerMean: number
  }
  outputPath: string
}

// ─── KPI label map ──────────────────────────────────────────────────────────

const KPI_LABELS: Record<string, string> = {
  ROI: "ROI",
  cistyZisk: "Čistý zisk",
  celkovaInvestice: "Celková investice",
  financniRezerva: "Finanční rezerva",
  likviditniKrytiProvozu: "Likviditní krytí provozu",
  miraVyuzitiVyrobniKapacity: "Využití výrobní kapacity",
  miraVyuzitiSkladovaciJednotky: "Využití skladové kapacity",
  spotrebaEnergie: "Spotřeba energie",
  miraNesplnenePoptavky: "Míra nesplněné poptávky",
  prumernaDobaCekaniSurovin: "Prům. doba čekání surovin",
  provozniMarze: "Provozní marže",
  nakladovostTrzeb: "Nákladovost tržeb",
  uspesnostPlneniObjednavek: "Úspěšnost plnění objednávek",
}

const STRATEGY_COLORS: Record<string, string> = {
  BALANCED: "#6366f1",
  AGGRESSIVE: "#ef4444",
  CONSERVATIVE: "#22c55e",
  MARKET_LEADER: "#f59e0b",
  DOMINANT: "#f59e0b",
  ADAPTIVE: "#06b6d4",
  RL: "#8b5cf6",
  EVOLUTIONARY: "#ec4899",
}

const STRATEGY_LABELS: Record<string, string> = {
  BALANCED: "Vyvážená",
  AGGRESSIVE: "Agresivní",
  CONSERVATIVE: "Konzervativní",
  MARKET_LEADER: "Tržní lídr",
  DOMINANT: "Dominantní",
  ADAPTIVE: "Adaptivní",
  RL: "RL (zpětnovazební)",
  EVOLUTIONARY: "Evoluční",
}

function getColor(variant: string): string {
  return STRATEGY_COLORS[variant] ?? "#94a3b8"
}

function getLabel(variant: string): string {
  return STRATEGY_LABELS[variant] ?? variant
}

function fmt(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "N/A"
  return value.toLocaleString("cs-CZ", { maximumFractionDigits: decimals })
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1)} %`
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function MetricCard({ metricResult }: { metricResult: ExperimentMetricResult }) {
  const [expanded, setExpanded] = useState(false)
  const label = KPI_LABELS[metricResult.metric] ?? metricResult.metric
  const best = metricResult.strategies[0]
  const maxMean = Math.max(...metricResult.strategies.map(s => Math.abs(s.mean)))

  return (
    <div
      className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden cursor-pointer hover:border-gray-500 transition-colors"
      onClick={() => setExpanded(e => !e)}
    >
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: getColor(best?.strategyVariant ?? "") }}
          />
          <span className="font-semibold text-white text-sm truncate">{label}</span>
          {metricResult.lowerIsBetter && (
            <span className="text-xs text-gray-400 bg-gray-700 px-1.5 py-0.5 rounded flex-shrink-0">↓ lepší</span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-2">
          <span className="text-xs text-gray-300">
            🥇{" "}
            <span className="font-semibold" style={{ color: getColor(best?.strategyVariant ?? "") }}>
              {getLabel(best?.strategyVariant ?? "N/A")}
            </span>{" "}
            <span className="text-gray-400">(μ={fmt(best?.mean ?? 0)})</span>
          </span>
          <span className="text-gray-500 text-sm">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-700 px-4 py-4 space-y-3">
          {metricResult.strategies.map((s) => {
            const barWidth = maxMean > 0 ? Math.abs(s.mean) / maxMean : 0
            return (
              <div key={s.strategyVariant} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-gray-200">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getColor(s.strategyVariant) }}
                    />
                    <span className="font-medium">#{s.rank}</span>
                    <span>{getLabel(s.strategyVariant)}</span>
                  </span>
                  <div className="text-right text-gray-300 space-x-2">
                    <span>μ={fmt(s.mean)}</span>
                    <span className="text-gray-500">σ={fmt(s.standardDeviation)}</span>
                    <span className="text-gray-500">
                      95% CI [{fmt(s.ci95Low)}, {fmt(s.ci95High)}]
                    </span>
                    <span className="text-gray-600">n={s.sampleSize}</span>
                  </div>
                </div>
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(barWidth * 100).toFixed(1)}%`,
                      backgroundColor: getColor(s.strategyVariant),
                      opacity: s.rank === 1 ? 1 : 0.55,
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AiVsStaticPanel({ data }: { data: ExperimentResult["aiVsStatic"] }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-4">
      <h3 className="text-white font-bold text-lg">⚔️ AI vs. Statické strategie</h3>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-cyan-900/30 border border-cyan-700/40 rounded-lg p-3">
          <p className="text-2xl font-bold text-cyan-300">{data.aiWins}</p>
          <p className="text-xs text-gray-400 mt-0.5">Výhry AI</p>
        </div>
        <div className="bg-gray-700/30 border border-gray-600/40 rounded-lg p-3">
          <p className="text-2xl font-bold text-gray-300">{data.ties}</p>
          <p className="text-xs text-gray-400 mt-0.5">Remízy</p>
        </div>
        <div className="bg-amber-900/30 border border-amber-700/40 rounded-lg p-3">
          <p className="text-2xl font-bold text-amber-300">{data.staticWins}</p>
          <p className="text-xs text-gray-400 mt-0.5">Výhry Statických</p>
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm text-gray-400">
          Míra výhry AI:{" "}
          <span className="font-bold text-cyan-300 text-base">{fmtPct(data.aiWinRate)}</span>
          <span className="text-gray-500 ml-2">({data.evaluatedMetrics} metrik)</span>
        </p>
      </div>
      <div className="border-t border-gray-700 pt-3 space-y-2">
        {data.metricOutcomes.map((o) => (
          <div key={o.metric} className="flex items-center gap-2 text-xs">
            <span
              className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center font-bold text-xs ${
                o.winner === "AI"
                  ? "bg-cyan-700/50 text-cyan-200"
                  : o.winner === "STATIC"
                  ? "bg-amber-700/50 text-amber-200"
                  : "bg-gray-700 text-gray-400"
              }`}
            >
              {o.winner === "AI" ? "AI" : o.winner === "STATIC" ? "S" : "="}
            </span>
            <span className="text-gray-300 min-w-0 truncate flex-1">
              {KPI_LABELS[o.metric] ?? o.metric}
            </span>
            <span className="text-gray-500 flex-shrink-0">
              {getLabel(o.aiBestStrategy)} {fmt(o.aiBestMean)} vs {getLabel(o.staticBestStrategy)} {fmt(o.staticBestMean)}
              {o.lowerIsBetter && " (↓)"}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PerRunTable({ perRun }: { data: ExperimentResult; perRun: ExperimentResult["perRun"] }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
      <button
        className="w-full px-5 py-3 flex items-center justify-between text-white font-semibold hover:bg-gray-750 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <span>📋 Výsledky po jednotlivých bězích ({perRun.length} běhů)</span>
        <span className="text-gray-400">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="overflow-x-auto border-t border-gray-700">
          <table className="w-full text-xs text-left">
            <thead className="bg-gray-900 text-gray-400">
              <tr>
                <th className="px-3 py-2">Seed</th>
                <th className="px-3 py-2">Firma</th>
                <th className="px-3 py-2">Strategie</th>
                <th className="px-3 py-2 text-right">ROI</th>
                <th className="px-3 py-2 text-right">Čistý zisk</th>
                <th className="px-3 py-2 text-right">Prov. marže</th>
                <th className="px-3 py-2 text-right">Úsp. objedn.</th>
              </tr>
            </thead>
            <tbody>
              {perRun.flatMap((run) =>
                run.companies.map((c, i) => (
                  <tr
                    key={`${run.seed}-${c.companyId}`}
                    className={i % 2 === 0 ? "bg-gray-800" : "bg-gray-850"}
                  >
                    <td className="px-3 py-1.5 text-gray-500 font-mono text-[10px]">{run.seed}</td>
                    <td className="px-3 py-1.5 text-gray-300">{c.companyName}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                        style={{
                          backgroundColor: `${getColor(c.strategyVariant)}22`,
                          color: getColor(c.strategyVariant),
                          border: `1px solid ${getColor(c.strategyVariant)}44`,
                        }}
                      >
                        {getLabel(c.strategyVariant)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-200">{fmt(c.kpi.ROI ?? 0)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-200">{fmt(c.kpi.cistyZisk ?? 0)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-200">
                      {fmtPct(c.kpi.provozniMarze ?? 0)}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-200">
                      {fmtPct(c.kpi.uspesnostPlneniObjednavek ?? 0)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ExperimentsPage() {
  const [runsPerStrategy, setRunsPerStrategy] = useState(10)
  const [tickCount, setTickCount] = useState(3650)
  const [seedPrefix, setSeedPrefix] = useState(`EXP-${Date.now()}`)
  const [adaptiveCarryover, setAdaptiveCarryover] = useState(false)

  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ExperimentResult | null>(null)

  const [existingExperiments, setExistingExperiments] = useState<string[] | null>(null)
  const [isLoadingList, setIsLoadingList] = useState(false)

  const handleRun = useCallback(async () => {
    setIsRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await apiFetch("/experiments/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runsPerStrategy,
          tickCount,
          seedPrefix,
          adaptiveCarryoverLearning: adaptiveCarryover,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as any)?.error?.message ?? `Server error ${res.status}`)
      }
      const data = await res.json()
      setResult(data.experiment as ExperimentResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsRunning(false)
    }
  }, [runsPerStrategy, tickCount, seedPrefix, adaptiveCarryover])

  const handleLoadLatest = useCallback(async () => {
    setIsRunning(true)
    setError(null)
    try {
      const res = await apiFetch("/experiments/latest")
      if (!res.ok) {
        if (res.status === 404) throw new Error("Žádný experiment zatím neexistuje.")
        throw new Error(`Server error ${res.status}`)
      }
      const data = await res.json()
      setResult(data.experiment as ExperimentResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsRunning(false)
    }
  }, [])

  const handleLoadList = useCallback(async () => {
    setIsLoadingList(true)
    try {
      const res = await apiFetch("/experiments/")
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data = await res.json()
      setExistingExperiments(data.files as string[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsLoadingList(false)
    }
  }, [])

  const handleLoadById = useCallback(async (id: string) => {
    setIsRunning(true)
    setError(null)
    try {
      const res = await apiFetch(`/experiments/${id}`)
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data = await res.json()
      setResult(data.experiment as ExperimentResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsRunning(false)
    }
  }, [])

  const downloadUrl = result
    ? `${API_CONFIG.baseUrl}/experiments/${result.experimentId}/download`
    : null
  const downloadLatestUrl = `${API_CONFIG.baseUrl}/experiments/latest/download`

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-950 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-gray-400 hover:text-white transition-colors text-sm"
          >
            ← Zpět
          </Link>
          <span className="text-gray-600">|</span>
          <h1 className="text-xl font-bold text-white">🧪 Experimenty — Srovnání strategií</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleLoadLatest}
            disabled={isRunning}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-600 bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            📂 Načíst poslední
          </button>
          <button
            onClick={handleLoadList}
            disabled={isLoadingList}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-600 bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {isLoadingList ? "Načítám…" : "📋 Vše"}
          </button>
          {downloadLatestUrl && (
            <a
              href={downloadLatestUrl}
              className="px-3 py-1.5 text-sm rounded-lg border border-indigo-600/50 bg-indigo-700/20 text-indigo-300 hover:bg-indigo-700/40 transition-colors"
            >
              ⬇ Stáhnout poslední JSON
            </a>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">

        {/* Existing experiments list */}
        {existingExperiments && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
            <h2 className="text-white font-bold mb-3 flex items-center justify-between">
              <span>📁 Uložené experimenty ({existingExperiments.length})</span>
              <button
                className="text-xs text-gray-400 hover:text-white"
                onClick={() => setExistingExperiments(null)}
              >
                ✕
              </button>
            </h2>
            {existingExperiments.length === 0 ? (
              <p className="text-gray-400 text-sm">Žádné experimenty zatím nebyly spuštěny.</p>
            ) : (
              <ul className="divide-y divide-gray-700 max-h-60 overflow-y-auto">
                {existingExperiments.map((file) => {
                  const id = file.replace(/\.json$/, "")
                  return (
                    <li
                      key={file}
                      className="flex items-center justify-between py-2 text-sm gap-3"
                    >
                      <span className="text-gray-300 font-mono text-xs truncate">{id}</span>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleLoadById(id)}
                          className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs transition-colors"
                        >
                          Zobrazit
                        </button>
                        <a
                          href={`${API_CONFIG.baseUrl}/experiments/${id}/download`}
                          className="px-2 py-0.5 rounded bg-indigo-700/30 hover:bg-indigo-700/50 text-indigo-300 text-xs transition-colors"
                        >
                          ⬇ JSON
                        </a>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        {/* Config panel */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-5">
          <h2 className="text-white text-lg font-bold">⚙️ Konfigurace experimentu</h2>
          <p className="text-gray-400 text-sm">
            Spustí <strong className="text-white">{runsPerStrategy}</strong> běhů simulace paralelně s různými seedy. 
            Každý běh trvá <strong className="text-white">{tickCount}</strong> ticků. 
            Výsledky jsou statisticky zprůměrovány pro každou strategii.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
                Počet běhů
              </label>
              <input
                type="number"
                min={10}
                max={500}
                value={runsPerStrategy}
                onChange={(e) => setRunsPerStrategy(Number(e.target.value))}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <p className="text-[10px] text-gray-500">Min. 10, max. 500</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
                Počet ticků
              </label>
              <input
                type="number"
                min={1}
                max={20000}
                value={tickCount}
                onChange={(e) => setTickCount(Number(e.target.value))}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <p className="text-[10px] text-gray-500">1 tick = 1 den</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
                Prefix seedu
              </label>
              <input
                type="text"
                maxLength={200}
                value={seedPrefix}
                onChange={(e) => setSeedPrefix(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <p className="text-[10px] text-gray-500">Seed = prefix + index</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
                Adaptivní přenášení učení
              </label>
              <div className="flex items-center h-[38px]">
                <button
                  onClick={() => setAdaptiveCarryover(v => !v)}
                  className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors ${
                    adaptiveCarryover ? "bg-indigo-600" : "bg-gray-600"
                  }`}
                >
                  <span
                    className={`inline-block w-4 h-4 bg-white rounded-full transition-transform ${
                      adaptiveCarryover ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
                <span className="ml-2 text-sm text-gray-300">
                  {adaptiveCarryover ? "Zapnuto" : "Vypnuto"}
                </span>
              </div>
              <p className="text-[10px] text-gray-500">Váhy AI strategií se přenáší mezi běhy</p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleRun}
              disabled={isRunning}
              className="px-6 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {isRunning ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Simuluji {runsPerStrategy} × {tickCount} ticků…
                </>
              ) : (
                "▶ Spustit experiment"
              )}
            </button>
            {isRunning && (
              <p className="text-xs text-gray-400">
                Experiment běží synchronně na serveru. Prosím čekejte…
              </p>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-5 py-4 text-red-300 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* Summary header */}
            <div className="bg-gradient-to-r from-indigo-900/40 to-purple-900/30 border border-indigo-700/30 rounded-xl p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div>
                  <p className="text-indigo-300 text-xs font-semibold uppercase tracking-widest mb-1">
                    Výsledky experimentu
                  </p>
                  <h2 className="text-2xl font-bold text-white">
                    🏆{" "}
                    <span style={{ color: getColor(result.objectiveSummary.winnerStrategy) }}>
                      {getLabel(result.objectiveSummary.winnerStrategy)}
                    </span>{" "}
                    je statisticky nejlepší
                  </h2>
                  <p className="text-gray-300 text-sm mt-1">
                    Metrika: <span className="text-white font-medium">Čistý zisk</span>{" "}
                    • průměr: <span className="text-white font-semibold">{fmt(result.objectiveSummary.winnerMean)}</span>
                    {" "} • skupina:{" "}
                    <span className={result.objectiveSummary.winnerGroup === "AI" ? "text-cyan-300" : "text-amber-300"}>
                      {result.objectiveSummary.winnerGroup === "AI" ? "AI strategie" : "Statická strategie"}
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  <div className="bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-2">
                    <p className="text-gray-400 text-xs">Běhů</p>
                    <p className="text-white font-bold">{result.config.runsPerStrategy}</p>
                  </div>
                  <div className="bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-2">
                    <p className="text-gray-400 text-xs">Ticků / běh</p>
                    <p className="text-white font-bold">{result.config.tickCount}</p>
                  </div>
                  <div className="bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-2">
                    <p className="text-gray-400 text-xs">Vygenerováno</p>
                    <p className="text-white font-bold text-xs">
                      {new Date(result.generatedAt).toLocaleString("cs-CZ")}
                    </p>
                  </div>
                  {downloadUrl && (
                    <a
                      href={downloadUrl}
                      className="flex items-center px-3 py-2 rounded-lg border border-indigo-600/50 bg-indigo-700/20 text-indigo-300 hover:bg-indigo-700/40 transition-colors text-sm font-semibold"
                    >
                      ⬇ Stáhnout JSON
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* AI vs Static */}
            <AiVsStaticPanel data={result.aiVsStatic} />

            {/* Metrics grid */}
            <div>
              <h2 className="text-white font-bold text-lg mb-3">📊 Výsledky podle metrik KPI</h2>
              <p className="text-gray-400 text-sm mb-4">
                Klikněte na metriku pro zobrazení detailní statistiky (průměr, směrodatná odchylka, 95% interval spolehlivosti).
              </p>
              <div className="grid grid-cols-1 gap-2">
                {result.metrics.map((m) => (
                  <MetricCard key={m.metric} metricResult={m} />
                ))}
              </div>
            </div>

            {/* Per-run table */}
            <PerRunTable data={result} perRun={result.perRun} />
          </div>
        )}
      </main>
    </div>
  )
}
