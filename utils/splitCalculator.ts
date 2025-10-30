/**
 * Calculadora de Splits por KM
 * Divide corrida em segmentos de 1km e calcula pace de cada
 */

import { Split } from './db';

interface CoordinateWithTime {
  coordinate: [number, number];
  timestamp: number;
  distance: number; // Distância acumulada até este ponto
}

/**
 * Calcula distância entre dois pontos (Haversine)
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Formata pace (min/km)
 */
function formatPace(seconds: number, distanceMeters: number): string {
  if (distanceMeters === 0) return '--:--';

  const paceInMinutesPerKm = (seconds / 60) / (distanceMeters / 1000);

  // Limitar a valores razoáveis
  if (paceInMinutesPerKm > 20 || paceInMinutesPerKm < 2) return '--:--';

  const minutes = Math.floor(paceInMinutesPerKm);
  const secs = Math.floor((paceInMinutesPerKm - minutes) * 60);

  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Calcula splits por KM baseado em coordenadas e timestamps
 *
 * @param coordinates Array de [lng, lat]
 * @param startTime Timestamp de início (ms)
 * @param endTime Timestamp de fim (ms)
 * @returns Array de splits
 */
export function calculateSplits(
  coordinates: [number, number][],
  startTime: number,
  endTime: number
): Split[] {
  if (coordinates.length < 2) return [];

  const totalDuration = (endTime - startTime) / 1000; // segundos
  const timePerPoint = totalDuration / (coordinates.length - 1);

  // Calcular distância acumulada para cada ponto
  const points: CoordinateWithTime[] = [];
  let accumulatedDistance = 0;

  coordinates.forEach((coord, index) => {
    if (index > 0) {
      const prev = coordinates[index - 1];
      const dist = calculateDistance(
        prev[1], // lat
        prev[0], // lng
        coord[1],
        coord[0]
      );
      accumulatedDistance += dist;
    }

    points.push({
      coordinate: coord,
      timestamp: startTime + (index * timePerPoint * 1000),
      distance: accumulatedDistance,
    });
  });

  // Dividir em splits de 1km
  const splits: Split[] = [];
  let currentKm = 1;
  let lastSplitDistance = 0;
  let lastSplitTime = startTime;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const targetDistance = currentKm * 1000; // Distância alvo em metros

    // Se alcançamos ou passamos o próximo KM
    if (point.distance >= targetDistance) {
      // Calcular tempo para este split
      const splitTime = (point.timestamp - lastSplitTime) / 1000; // segundos
      const splitDistance = point.distance - lastSplitDistance;

      splits.push({
        km: currentKm,
        time: splitTime,
        pace: formatPace(splitTime, splitDistance),
        distance: splitDistance,
      });

      lastSplitDistance = point.distance;
      lastSplitTime = point.timestamp;
      currentKm++;
    }
  }

  // Adicionar último split (pode ser < 1km)
  const lastPoint = points[points.length - 1];
  const remainingDistance = lastPoint.distance - lastSplitDistance;

  if (remainingDistance > 100) { // Mínimo 100m para considerar split
    const splitTime = (lastPoint.timestamp - lastSplitTime) / 1000;

    splits.push({
      km: currentKm,
      time: splitTime,
      pace: formatPace(splitTime, remainingDistance),
      distance: remainingDistance,
    });
  }

  return splits;
}

/**
 * Calcula estatísticas dos splits
 */
export function getSplitStats(splits: Split[]): {
  bestPace: string;
  worstPace: string;
  averagePace: string;
  bestKm: number;
  worstKm: number;
} {
  if (splits.length === 0) {
    return {
      bestPace: '--:--',
      worstPace: '--:--',
      averagePace: '--:--',
      bestKm: 0,
      worstKm: 0,
    };
  }

  // Converter pace string para segundos por km para comparação
  const paceToSeconds = (pace: string): number => {
    if (pace === '--:--') return Infinity;
    const [min, sec] = pace.split(':').map(Number);
    return min * 60 + sec;
  };

  const paceInSeconds = splits.map(s => ({
    km: s.km,
    seconds: paceToSeconds(s.pace),
    pace: s.pace,
  }));

  // Filtrar valores inválidos
  const validPaces = paceInSeconds.filter(p => p.seconds !== Infinity && p.seconds > 0);

  if (validPaces.length === 0) {
    return {
      bestPace: '--:--',
      worstPace: '--:--',
      averagePace: '--:--',
      bestKm: 0,
      worstKm: 0,
    };
  }

  // Melhor pace (menor tempo)
  const best = validPaces.reduce((min, p) => p.seconds < min.seconds ? p : min);

  // Pior pace (maior tempo)
  const worst = validPaces.reduce((max, p) => p.seconds > max.seconds ? p : max);

  // Pace médio
  const avgSeconds = validPaces.reduce((sum, p) => sum + p.seconds, 0) / validPaces.length;
  const avgMin = Math.floor(avgSeconds / 60);
  const avgSec = Math.floor(avgSeconds % 60);
  const averagePace = `${avgMin}:${avgSec.toString().padStart(2, '0')}`;

  return {
    bestPace: best.pace,
    worstPace: worst.pace,
    averagePace,
    bestKm: best.km,
    worstKm: worst.km,
  };
}
