import React from "react";
import { apiFetch } from "@/lib/api";

type ControlPanelProps = {
  sendMessage: (message: object) => void;
  onStopSimulation?: () => void;
  learningModeData?: {
    enabled: boolean;
    completedIterations: number;
    autoRestartIterations: number;
    currentIteration?: number;
    lastSeedUsed?: string;
  };
};

const ControlPanel = ({ sendMessage, onStopSimulation, learningModeData }: ControlPanelProps) => {
  const learningActive = learningModeData?.enabled ?? false;

  const handleStartNormal = () => {
    sendMessage({ action: "start" });
  };

  const handleStartLearning = () => {
    // Make API call to backend to start learning mode
    apiFetch("/controls/sim/start-learning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).catch(err => console.error("Failed to start learning mode:", err));
  };

  return (
    <div className="flex items-center justify-between px-6 py-4">
      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-white text-xl font-bold leading-tight">Ovládací panel simulace</h1>
          <p className="text-xs text-gray-400 mt-1">Ovládání běhu simulace v reálném čase</p>
        </div>
      </div>

      <div className="flex gap-3 items-center">
        {/* Learning Mode Status */}
        {learningActive && learningModeData?.enabled && (
          <div className="bg-blue-900/50 border border-blue-500/50 px-4 py-2.5 rounded-lg text-sm">
            <div className="text-blue-300 font-semibold">
              Režim učení: {learningModeData.completedIterations + 1}/{learningModeData.autoRestartIterations}
            </div>
            <div className="text-blue-200 text-xs mt-1">
              Seed: {learningModeData.lastSeedUsed?.substring(0, 25)}...
            </div>
          </div>
        )}

        {/* Control Buttons */}
        <button
          className="bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors border border-green-500/40"
          onClick={handleStartNormal}
        >
          ▶ Spustit
        </button>
        <button
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors border border-blue-500/40"
          onClick={handleStartLearning}
          title="Spustí nepřetržitý režim učení – strategie se učí přes více iterací"
        >
          🧠 Učení
        </button>
        <button
          className="bg-yellow-600 hover:bg-yellow-700 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors border border-yellow-500/40"
          onClick={() => sendMessage({ action: "pause" })}
        >
          ⏸ Pozastavit
        </button>
        <button
          className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors border border-red-500/40"
          onClick={() => {
            if (onStopSimulation) {
              onStopSimulation();
              return;
            }
            sendMessage({ action: "stop" });
          }}
        >
          ⏹ Ukončit simulaci
        </button>
      </div>
    </div>
  );
};

export default ControlPanel;