"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import ControlPanel from "../components/controlPanel/ControlPanel";
import CompanyDashboard from "../components/dashboard/CompanyDashboard";
import LogViewer from "../components/messageLogs/LogViewer";
import KPIDashboard from "../components/kpi/KPIDashboard";
import { apiFetch, createWebSocket } from "@/lib/api";
import { SimulationMessageData } from "@/lib/types";

const Map = dynamic(() => import("@/components/map/Map"), {
  ssr: false, // This ensures it only renders on the client
  loading: () => <p>Loading Map...</p>
});

type ViewMode = "dashboard" | "kpi" | "summary";

type LearningModeData = {
  enabled: boolean;
  completedIterations: number;
  autoRestartIterations: number;
  currentIteration?: number;
  lastSeedUsed?: string;
};

export default function Home() {
  const socket = useMemo(() => createWebSocket(), []);
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  const [lastSimulationData, setLastSimulationData] =
    useState<SimulationMessageData | null>(null);
  const [learningModeData, setLearningModeData] = useState<LearningModeData | undefined>(undefined);
  const [learningModeMessage, setLearningModeMessage] = useState<string | null>(null);
  const [isFinalSummaryLoading, setIsFinalSummaryLoading] = useState(false);
  const [finalSummary, setFinalSummary] = useState<string | null>(null);
  const lastWsSendRef = useRef(0);
  const [simulationEnded, setSimulationEnded] = useState(false);
  const autoFinalRequestedRef = useRef(false);

  const fetchFinalSummary = useCallback(async () => {
    setIsFinalSummaryLoading(true);
    try {
      const response = await apiFetch("/data/sim/final-summary");
      if (!response.ok) {
        throw new Error(`Summary failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (payload?.finalState) {
        setLastSimulationData(payload.finalState as SimulationMessageData);
      }

      setFinalSummary(
        typeof payload?.finalSummary === "string" && payload.finalSummary.trim()
          ? payload.finalSummary
          : "Simulace byla ukončena, ale shrnutí není dostupné."
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Neznámá chyba při generování shrnutí";
      setFinalSummary(`Nepodařilo se načíst finální shrnutí: ${message}`);
    } finally {
      setIsFinalSummaryLoading(false);
    }
  }, []);

  const handleNewSimulation = useCallback(async () => {
    try {
      await apiFetch("/controls/sim/reset", { method: "POST" });
      // Fetch the fresh sim state so the dashboard shows the new simulation
      const stateRes = await apiFetch("/controls/sim/state");
      if (stateRes.ok) {
        const freshState = await stateRes.json();
        setLastSimulationData(freshState as SimulationMessageData);
      }
    } catch (err) {
      console.error("Failed to reset simulation:", err);
    }
    setViewMode("dashboard");
    setFinalSummary(null);
    setSimulationEnded(false);
    autoFinalRequestedRef.current = false;
  }, []);

  const handleStopSimulation = useCallback(async () => {
    autoFinalRequestedRef.current = true;
    setSimulationEnded(true);
    setViewMode("summary");
    setFinalSummary(null);
    setIsFinalSummaryLoading(true);

    try {
      const response = await apiFetch("/controls/sim/stop", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Stop failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (payload?.finalState) {
        setLastSimulationData(payload.finalState as SimulationMessageData);
      }

      setFinalSummary(
        typeof payload?.finalSummary === "string" && payload.finalSummary.trim()
          ? payload.finalSummary
          : "Simulace byla ukončena, ale shrnutí není dostupné."
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Neznámá chyba při ukončení simulace";
      setFinalSummary(`Nepodařilo se načíst finální shrnutí: ${message}`);
    } finally {
      setIsFinalSummaryLoading(false);
    }
  }, []);

  const sendThrottled = useCallback(
    (message: object) => {
      const now = Date.now();
      if (now - lastWsSendRef.current < 200) return;
      if (socket.readyState !== WebSocket.OPEN) return;

      socket.send(JSON.stringify(message));
      lastWsSendRef.current = now;
    },
    [socket]
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);
        
        // Handle learning mode restart message
        if (message?.type === "learning-mode-restart" && message.data) {
          setLearningModeMessage(message.data.message);
          setLearningModeData(message.data);
          setViewMode("dashboard");
          autoFinalRequestedRef.current = false; // Reset to allow auto-summary on next finish
          // Don't show summary view during learning mode restart
          return;
        }

        // Handle learning mode completion message
        if (message?.type === "learning-mode-completed" && message.data) {
          setLearningModeMessage(message.data.message);
          setLearningModeData(undefined); // Clear learning mode data
          autoFinalRequestedRef.current = false;
          // Optionally show summary or keep dashboard visible
          return;
        }

        if (message?.type === "state" && message.data) {
          const nextState = message.data as SimulationMessageData;
          setLastSimulationData(nextState);
          const isLearningModeActive = Boolean(message?.learningMode?.enabled);
          
          // Update learning mode data from state message
          if (message.learningMode) {
            setLearningModeData(message.learningMode);
          } else {
            setLearningModeData(undefined);
          }

          if (nextState.finished && !autoFinalRequestedRef.current && !isLearningModeActive) {
            autoFinalRequestedRef.current = true;
            setSimulationEnded(true);
            setViewMode("summary");
            setFinalSummary(null);
            void fetchFinalSummary();
          }
        }
      } catch {
        // ignore non-JSON websocket messages
      }
    };

    socket.addEventListener("message", handleMessage);

    return () => {
      socket.removeEventListener("message", handleMessage);
      socket.close();
    };
  }, [fetchFinalSummary, socket]);

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-900">
      {/* Header with Control Panel */}
      <div className="bg-gray-950 border-b border-gray-700/80">
        {learningModeMessage && (
          <div className="bg-blue-900/50 border-b border-blue-500/30 px-6 py-3 text-center">
            <p className="text-blue-200 font-semibold animate-pulse">{learningModeMessage}</p>
          </div>
        )}
        <ControlPanel 
          sendMessage={sendThrottled} 
          onStopSimulation={handleStopSimulation}
          learningModeData={learningModeData}
        />
        
        {/* View Switcher */}
        <div className="flex items-center gap-2 px-6 pb-3">
          <button
            onClick={() => setViewMode("dashboard")}
            className={`px-4 py-2 rounded-lg font-semibold transition-colors border ${
              viewMode === "dashboard"
                ? "bg-blue-600 text-white border-blue-500/40"
                : "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700"
            }`}
          >
            📊 Dashboard
          </button>
          <button
            onClick={() => setViewMode("kpi")}
            className={`px-4 py-2 rounded-lg font-semibold transition-colors border ${
              viewMode === "kpi"
                ? "bg-blue-600 text-white border-blue-500/40"
                : "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700"
            }`}
          >
            📈 KPI přehled
          </button>
          <button
            onClick={() => setViewMode("summary")}
            className={`px-4 py-2 rounded-lg font-semibold transition-colors border ${
              viewMode === "summary"
                ? "bg-blue-600 text-white border-blue-500/40"
                : "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700"
            }`}
          >
            📝 Obecné shrnutí
          </button>
          <div className="flex-1" />
          <Link
            href="/experiments"
            className="px-4 py-2 rounded-lg font-semibold bg-purple-700 text-white hover:bg-purple-600 transition-colors"
          >
            🧪 Experimenty
          </Link>
          <Link
            href="/history"
            className="px-4 py-2 rounded-lg font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            📋 Historie simulací
          </Link>
        </div>
        <div className="px-6 pb-4 flex items-center justify-between text-xs text-gray-400">
          <p>Po ukončení simulace zůstává zobrazen poslední snapshot.</p>
          <div className="px-3 py-1 rounded-full bg-gray-800 border border-gray-700 text-gray-300">
            Seed: {lastSimulationData?.seed ?? "N/A"}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === "summary" ? (
        <div className="flex-1 p-6 md:p-8 overflow-auto text-white bg-gray-900">
          <div className="max-w-5xl mx-auto bg-gray-950 border border-gray-700 rounded-2xl p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
              <div>
                <p className="text-sm text-blue-300 font-semibold tracking-wide uppercase">Výsledky simulace</p>
                <h2 className="text-3xl font-bold mt-1">📝 Obecné shrnutí</h2>
                {simulationEnded && (
                  <button
                    onClick={handleNewSimulation}
                    className="mt-3 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 active:scale-95 text-white font-semibold text-sm transition-all shadow-lg shadow-green-900/40"
                  >
                    🔄 Nová simulace
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700">
                  <p className="text-gray-400">Seed</p>
                  <p className="text-white font-semibold">{lastSimulationData?.seed ?? "N/A"}</p>
                </div>
                <div className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700">
                  <p className="text-gray-400">Tick</p>
                  <p className="text-white font-semibold">{lastSimulationData?.tick ?? "N/A"}</p>
                </div>
              </div>
            </div>

            {isFinalSummaryLoading ? (
              <div className="bg-gray-900 border border-blue-500/30 rounded-lg p-5">
                <p className="text-blue-300 font-medium">Generuji obecné shrnutí simulace...</p>
                <p className="text-gray-400 text-sm mt-2">Shrnutí se počítá lokálně z finálního stavu a logu.</p>
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-700 rounded-lg p-5 whitespace-pre-wrap leading-relaxed text-gray-100">
                {finalSummary ?? "Shrnutí zatím není dostupné. Po ukončení simulace se zobrazí zde."}
              </div>
            )}
          </div>
        </div>
      ) : viewMode === "dashboard" ? (
        <div className="flex-1 flex gap-4 p-4 overflow-hidden">
          {/* Left: Map */}
          <div className="w-1/3 min-w-0">
            <div className="h-full rounded-lg overflow-hidden border border-gray-700">
              <Map />
            </div>
          </div>

          {/* Middle: Company Dashboard */}
          <div className="w-1/3 min-w-0">
            <CompanyDashboard socket={socket} initialData={lastSimulationData} />
          </div>

          {/* Right: Log Viewer */}
          <div className="w-1/3 min-w-0">
            <LogViewer />
          </div>
        </div>
      ) : (
        <div className="flex-1 p-4 overflow-hidden">
          <KPIDashboard socket={socket} initialData={lastSimulationData} />
        </div>
      )}
    </div>
  );
}
