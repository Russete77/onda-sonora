'use client';

import { Split } from '@/utils/db';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';

interface RunChartsProps {
  splits: Split[];
  elevations?: number[]; // Array de elevações ao longo do percurso
}

export default function RunCharts({ splits, elevations }: RunChartsProps) {
  if (splits.length === 0) {
    return null;
  }

  // Preparar dados para gráfico de pace
  const paceData = splits.map((split) => {
    // Converter pace string (min:sec) para número (minutos decimais)
    const [min, sec] = split.pace.split(':').map(Number);
    const paceValue = min + sec / 60;

    return {
      km: split.km,
      pace: isNaN(paceValue) || paceValue > 15 ? null : paceValue, // Ignorar valores inválidos
      label: `KM ${split.km}`,
      paceLabel: split.pace,
    };
  });

  // Preparar dados para gráfico de velocidade
  const speedData = splits.map((split) => {
    const [min, sec] = split.pace.split(':').map(Number);
    const paceValue = min + sec / 60;

    // Converter pace para velocidade (km/h)
    const speed = paceValue > 0 && isFinite(paceValue) ? 60 / paceValue : 0;

    return {
      km: split.km,
      speed: speed > 0 && speed < 30 ? speed : null, // Limitar a valores razoáveis
      label: `KM ${split.km}`,
    };
  });

  // Custom Tooltip para Pace
  const PaceTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-black/90 border border-purple-500/50 rounded-lg px-3 py-2">
          <p className="text-white font-bold">{payload[0].payload.label}</p>
          <p className="text-purple-400">Pace: {payload[0].payload.paceLabel}</p>
        </div>
      );
    }
    return null;
  };

  // Custom Tooltip para Velocidade
  const SpeedTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-black/90 border border-green-500/50 rounded-lg px-3 py-2">
          <p className="text-white font-bold">{payload[0].payload.label}</p>
          <p className="text-green-400">
            Velocidade: {payload[0].value.toFixed(1)} km/h
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Gráfico de Pace */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
        <h3 className="text-lg font-bold text-white mb-3">Pace por KM</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={paceData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis
              dataKey="label"
              stroke="rgba(255,255,255,0.5)"
              style={{ fontSize: '12px' }}
            />
            <YAxis
              stroke="rgba(255,255,255,0.5)"
              style={{ fontSize: '12px' }}
              domain={['auto', 'auto']}
              reversed
              label={{
                value: 'min/km',
                angle: -90,
                position: 'insideLeft',
                style: { fill: 'rgba(255,255,255,0.5)', fontSize: '12px' },
              }}
            />
            <Tooltip content={<PaceTooltip />} />
            <Line
              type="monotone"
              dataKey="pace"
              stroke="#a855f7"
              strokeWidth={3}
              dot={{ fill: '#a855f7', r: 5 }}
              activeDot={{ r: 7 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
        <div className="text-xs text-gray-400 text-center mt-2">
          Menor pace = Melhor desempenho
        </div>
      </div>

      {/* Gráfico de Velocidade */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
        <h3 className="text-lg font-bold text-white mb-3">Velocidade por KM</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={speedData}>
            <defs>
              <linearGradient id="speedGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis
              dataKey="label"
              stroke="rgba(255,255,255,0.5)"
              style={{ fontSize: '12px' }}
            />
            <YAxis
              stroke="rgba(255,255,255,0.5)"
              style={{ fontSize: '12px' }}
              label={{
                value: 'km/h',
                angle: -90,
                position: 'insideLeft',
                style: { fill: 'rgba(255,255,255,0.5)', fontSize: '12px' },
              }}
            />
            <Tooltip content={<SpeedTooltip />} />
            <Area
              type="monotone"
              dataKey="speed"
              stroke="#10b981"
              strokeWidth={3}
              fill="url(#speedGradient)"
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
        <div className="text-xs text-gray-400 text-center mt-2">
          Maior velocidade = Melhor desempenho
        </div>
      </div>

      {/* Gráfico de Elevação (se houver dados) */}
      {elevations && elevations.length > 0 && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <h3 className="text-lg font-bold text-white mb-3">Perfil de Elevação</h3>
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart
              data={elevations.map((elev, idx) => ({
                point: idx,
                elevation: elev,
              }))}
            >
              <defs>
                <linearGradient id="elevGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis hide />
              <YAxis
                stroke="rgba(255,255,255,0.5)"
                style={{ fontSize: '12px' }}
                label={{
                  value: 'metros',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fill: 'rgba(255,255,255,0.5)', fontSize: '12px' },
                }}
              />
              <Tooltip
                content={({ active, payload }: any) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-black/90 border border-orange-500/50 rounded-lg px-3 py-2">
                        <p className="text-orange-400">
                          Elevação: {payload[0].value.toFixed(0)}m
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Area
                type="monotone"
                dataKey="elevation"
                stroke="#f59e0b"
                strokeWidth={2}
                fill="url(#elevGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
