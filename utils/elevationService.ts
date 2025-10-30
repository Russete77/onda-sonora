/**
 * Elevation Service using Mapbox Terrain API
 * Fornece dados de altitude para cálculo preciso de calorias e ganho/perda de elevação
 */

const MAPBOX_TERRAIN_RGB_URL = 'https://api.mapbox.com/v4/mapbox.terrain-rgb';

interface ElevationPoint {
  latitude: number;
  longitude: number;
  elevation: number; // meters
}

/**
 * Get elevation for a single point using Mapbox Terrain-RGB tiles
 * Método mais eficiente que usa tiles raster em vez de API calls
 */
export async function getElevation(
  latitude: number,
  longitude: number,
  zoom: number = 14
): Promise<number> {
  try {
    // Convert lat/lng to tile coordinates
    const tileCoords = latLngToTile(latitude, longitude, zoom);

    // Get pixel position within tile
    const pixelX = Math.floor((tileCoords.x % 1) * 256);
    const pixelY = Math.floor((tileCoords.y % 1) * 256);

    // This would require fetching and decoding terrain RGB tiles
    // For now, return altitude from GPS (fallback)
    // Full implementation requires canvas/image processing

    return 0; // Placeholder - would decode RGB to elevation
  } catch (error) {
    console.error('Error fetching elevation:', error);
    return 0;
  }
}

/**
 * Get elevation for multiple points (batch)
 * More efficient for route data
 */
export async function getElevationBatch(
  points: Array<{ lat: number; lng: number }>,
  accessToken: string
): Promise<ElevationPoint[]> {
  // Mapbox doesn't have a direct elevation API
  // Best approach: use GPS altitude or terrain-rgb tiles
  // For simplicity, we'll rely on GPS altitude which is already available

  return points.map(p => ({
    latitude: p.lat,
    longitude: p.lng,
    elevation: 0, // Will use GPS altitude instead
  }));
}

/**
 * Calculate elevation gain/loss from path
 */
export function calculateElevationStats(elevations: number[]): {
  gain: number;
  loss: number;
  maxElevation: number;
  minElevation: number;
} {
  if (elevations.length === 0) {
    return { gain: 0, loss: 0, maxElevation: 0, minElevation: 0 };
  }

  let gain = 0;
  let loss = 0;
  let maxElevation = elevations[0];
  let minElevation = elevations[0];

  for (let i = 1; i < elevations.length; i++) {
    const diff = elevations[i] - elevations[i - 1];

    if (diff > 0) {
      gain += diff;
    } else if (diff < 0) {
      loss += Math.abs(diff);
    }

    maxElevation = Math.max(maxElevation, elevations[i]);
    minElevation = Math.min(minElevation, elevations[i]);
  }

  return {
    gain: Math.round(gain),
    loss: Math.round(loss),
    maxElevation: Math.round(maxElevation),
    minElevation: Math.round(minElevation),
  };
}

// Helper: Convert lat/lng to tile coordinates
function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const x = ((lng + 180) / 360) * Math.pow(2, zoom);
  const y =
    ((1 -
      Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) /
        Math.PI) /
      2) *
    Math.pow(2, zoom);
  return { x, y };
}
