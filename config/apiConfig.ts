/**
 * Configuração de APIs pagas do Mapbox
 * Controle de custos e monitoramento de uso
 */

export const API_CONFIG = {
  // Map Matching API - Correção de trajeto nas ruas
  MAP_MATCHING: {
    enabled: true, // ← Alterar para false para desabilitar completamente
    showWarning: true, // Mostrar aviso antes de usar
    cost: {
      perRequest: 0.005, // $5 por 1000 requests = $0.005 por request
      freeTier: 100000, // 100K requests/mês grátis
    },
    description: 'Corrige trajeto GPS para seguir ruas reais (como Strava)',
  },

  // Snap to Roads - Tempo real
  SNAP_TO_ROADS: {
    enabled: false, // Desabilitado por padrão (usa mesmo endpoint que Map Matching)
    showWarning: true,
    cost: {
      perRequest: 0.005,
      freeTier: 100000,
    },
    description: 'Cola GPS nas ruas em tempo real',
  },

  // Elevation/Terrain API
  ELEVATION_API: {
    enabled: false, // Usar GPS altitude nativo (grátis)
    showWarning: true,
    cost: {
      perRequest: 0.005,
      freeTier: 0, // Terrain-RGB não tem free tier direto
    },
    description: 'Dados precisos de elevação',
  },
} as const;

/**
 * Contador de uso de APIs pagas
 * Salvo em localStorage para monitoramento
 */
export interface ApiUsageStats {
  mapMatching: {
    count: number;
    lastUsed: number | null;
    totalCost: number;
  };
  snapToRoads: {
    count: number;
    lastUsed: number | null;
    totalCost: number;
  };
  elevation: {
    count: number;
    lastUsed: number | null;
    totalCost: number;
  };
  month: string; // YYYY-MM para resetar mensalmente
}

const STORAGE_KEY = 'ondasonora_api_usage';

/**
 * Get current month key
 */
function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get API usage stats
 */
export function getApiUsageStats(): ApiUsageStats {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return createEmptyStats();
    }

    const stats: ApiUsageStats = JSON.parse(stored);

    // Reset if new month
    if (stats.month !== getCurrentMonth()) {
      return createEmptyStats();
    }

    return stats;
  } catch (error) {
    console.error('Error loading API usage stats:', error);
    return createEmptyStats();
  }
}

/**
 * Create empty stats object
 */
function createEmptyStats(): ApiUsageStats {
  return {
    mapMatching: { count: 0, lastUsed: null, totalCost: 0 },
    snapToRoads: { count: 0, lastUsed: null, totalCost: 0 },
    elevation: { count: 0, lastUsed: null, totalCost: 0 },
    month: getCurrentMonth(),
  };
}

/**
 * Save API usage stats
 */
function saveApiUsageStats(stats: ApiUsageStats): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch (error) {
    console.error('Error saving API usage stats:', error);
  }
}

/**
 * Track API usage
 */
export function trackApiUsage(
  api: 'mapMatching' | 'snapToRoads' | 'elevation',
  count: number = 1
): void {
  const stats = getApiUsageStats();
  const config = API_CONFIG[
    api === 'mapMatching' ? 'MAP_MATCHING' :
    api === 'snapToRoads' ? 'SNAP_TO_ROADS' :
    'ELEVATION_API'
  ];

  stats[api].count += count;
  stats[api].lastUsed = Date.now();
  stats[api].totalCost += count * config.cost.perRequest;

  saveApiUsageStats(stats);

  // Log warning se próximo do limite
  const freeTier = config.cost.freeTier;
  if (freeTier > 0 && stats[api].count > freeTier * 0.8) {
    console.warn(
      `⚠️ API Usage Warning: ${api} at ${stats[api].count}/${freeTier} (${Math.round((stats[api].count / freeTier) * 100)}%)`
    );
  }
}

/**
 * Get total estimated cost this month
 */
export function getTotalEstimatedCost(): number {
  const stats = getApiUsageStats();
  return stats.mapMatching.totalCost + stats.snapToRoads.totalCost + stats.elevation.totalCost;
}

/**
 * Check if within free tier
 */
export function isWithinFreeTier(): boolean {
  const stats = getApiUsageStats();

  const mapMatchingLimit = API_CONFIG.MAP_MATCHING.cost.freeTier;
  const snapToRoadsLimit = API_CONFIG.SNAP_TO_ROADS.cost.freeTier;

  return (
    stats.mapMatching.count < mapMatchingLimit &&
    stats.snapToRoads.count < snapToRoadsLimit
  );
}

/**
 * Reset stats (manual, or auto on new month)
 */
export function resetApiUsageStats(): void {
  saveApiUsageStats(createEmptyStats());
}
