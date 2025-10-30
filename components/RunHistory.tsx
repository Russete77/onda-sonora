'use client';

import { useEffect, useState } from 'react';
import { getAllRuns, deleteRun, RunData, getTotalStats } from '@/utils/db';

interface RunHistoryProps {
  onClose: () => void;
  onViewRun: (run: RunData) => void;
}

export default function RunHistory({ onClose, onViewRun }: RunHistoryProps) {
  const [runs, setRuns] = useState<RunData[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalRuns: 0,
    totalDistance: 0,
    totalTime: 0,
    totalElevationGain: 0,
    averagePace: 0,
    longestRun: 0,
  });

  useEffect(() => {
    loadRuns();
  }, []);

  const loadRuns = async () => {
    try {
      const allRuns = await getAllRuns();
      const totalStats = await getTotalStats();
      setRuns(allRuns);
      setStats(totalStats);
    } catch (error) {
      console.error('Error loading runs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRun = async (id: number) => {
    if (!confirm('Deletar esta corrida?')) return;

    try {
      await deleteRun(id);
      await loadRuns();
    } catch (error) {
      console.error('Error deleting run:', error);
    }
  };

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const formatPace = (pace: number): string => {
    if (pace === 0 || !isFinite(pace)) return '--:--';
    const minutes = Math.floor(pace);
    const seconds = Math.floor((pace - minutes) * 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/95 z-[110] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-green-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/95 z-[110] overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-white">Histórico</h1>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
            <div className="text-xs text-white/40 uppercase mb-1">Corridas</div>
            <div className="text-2xl font-bold text-white">{stats.totalRuns}</div>
          </div>
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
            <div className="text-xs text-white/40 uppercase mb-1">Distância</div>
            <div className="text-2xl font-bold text-white">{(stats.totalDistance / 1000).toFixed(1)} km</div>
          </div>
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
            <div className="text-xs text-white/40 uppercase mb-1">Tempo</div>
            <div className="text-2xl font-bold text-white">{formatTime(stats.totalTime)}</div>
          </div>
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
            <div className="text-xs text-white/40 uppercase mb-1">Recorde</div>
            <div className="text-2xl font-bold text-white">{(stats.longestRun / 1000).toFixed(1)} km</div>
          </div>
        </div>

        {/* Run List */}
        {runs.length === 0 ? (
          <div className="text-center py-20">
            <svg className="w-12 h-12 mx-auto mb-4 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <div className="text-white/60 text-sm">Nenhuma corrida salva</div>
          </div>
        ) : (
          <div className="space-y-3">
            {runs.map((run) => (
              <div
                key={run.id}
                className="group bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 rounded-xl p-4 transition-all cursor-pointer"
                onClick={() => onViewRun(run)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 flex-1">
                    <svg className="w-6 h-6 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <div className="flex-1">
                      <div className="text-white text-sm font-medium mb-1">{run.date}</div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-green-400 font-medium">
                          {(run.distance / 1000).toFixed(2)} km
                        </span>
                        <span className="text-white/40">•</span>
                        <span className="text-blue-400 font-medium">
                          {formatTime(run.duration)}
                        </span>
                        <span className="text-white/40">•</span>
                        <span className="text-purple-400 font-medium">
                          {formatPace(run.averagePace)}
                        </span>
                        {run.routeMatched && (
                          <>
                            <span className="text-white/40">•</span>
                            <svg className="w-3 h-3 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                            </svg>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (run.id) handleDeleteRun(run.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 transition-all p-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
