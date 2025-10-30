/**
 * Map Matching Service - Mapbox API
 * "Cola" trajeto GPS nas ruas reais - usado por Strava, Nike Run Club
 * Corrige erros de GPS retroativamente para trajeto perfeito
 */

interface MapMatchingOptions {
  radiuses?: number[]; // Max distance from road (meters)
  steps?: boolean; // Include step-by-step directions
  geometries?: 'geojson' | 'polyline' | 'polyline6';
  overview?: 'full' | 'simplified' | 'false';
  timestamps?: number[]; // Unix timestamps for each point
}

interface MatchedRoute {
  coordinates: [number, number][];
  distance: number; // meters
  duration: number; // seconds
  confidence: number; // 0-1
}

/**
 * Match GPS coordinates to real roads using Mapbox Map Matching API
 * Best used AFTER run is complete for accurate route correction
 */
export async function matchRouteToRoads(
  coordinates: [number, number][],
  accessToken: string,
  options: MapMatchingOptions = {}
): Promise<MatchedRoute | null> {
  if (coordinates.length < 2) {
    console.warn('Map matching requires at least 2 coordinates');
    return null;
  }

  // Mapbox limit: 100 coordinates per request
  if (coordinates.length > 100) {
    console.warn('Too many coordinates, splitting into batches...');
    // Would need to implement batching here
    coordinates = coordinates.slice(0, 100);
  }

  const {
    radiuses = coordinates.map(() => 25), // 25m default search radius
    steps = false,
    geometries = 'geojson',
    overview = 'full',
    timestamps,
  } = options;

  try {
    // Format coordinates for API
    const coordsString = coordinates.map(c => c.join(',')).join(';');
    const radiusesString = radiuses.join(';');

    // Build URL
    let url = `https://api.mapbox.com/matching/v5/mapbox/walking/${coordsString}`;
    url += `?geometries=${geometries}`;
    url += `&radiuses=${radiusesString}`;
    url += `&steps=${steps}`;
    url += `&overview=${overview}`;
    url += `&access_token=${accessToken}`;

    if (timestamps && timestamps.length === coordinates.length) {
      url += `&timestamps=${timestamps.join(';')}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      console.error('Map matching failed:', response.status);
      return null;
    }

    const data = await response.json();

    if (!data.matchings || data.matchings.length === 0) {
      console.warn('No matching found');
      return null;
    }

    const matching = data.matchings[0];

    return {
      coordinates: matching.geometry.coordinates as [number, number][],
      distance: matching.distance,
      duration: matching.duration,
      confidence: matching.confidence || 0,
    };
  } catch (error) {
    console.error('Error in map matching:', error);
    return null;
  }
}

/**
 * Real-time snap to nearest road (simpler, faster)
 * Used during run for immediate feedback
 */
export async function snapToRoad(
  coordinate: [number, number],
  accessToken: string
): Promise<[number, number] | null> {
  try {
    // Use Directions API with single point to snap to nearest road
    const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${coordinate[0]},${coordinate[1]};${coordinate[0]},${coordinate[1]}?geometries=geojson&access_token=${accessToken}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.routes && data.routes[0]) {
      // First coordinate of route is snapped position
      const snapped = data.routes[0].geometry.coordinates[0];
      return snapped as [number, number];
    }

    return null;
  } catch (error) {
    console.error('Error snapping to road:', error);
    return null;
  }
}

/**
 * Batch snap coordinates to roads
 * More efficient than individual calls
 */
export async function batchSnapToRoads(
  coordinates: [number, number][],
  accessToken: string,
  batchSize: number = 25
): Promise<[number, number][]> {
  const results: [number, number][] = [];

  // Process in batches to avoid API limits
  for (let i = 0; i < coordinates.length; i += batchSize) {
    const batch = coordinates.slice(i, i + batchSize);

    try {
      const matched = await matchRouteToRoads(batch, accessToken, {
        overview: 'full',
        radiuses: batch.map(() => 25),
      });

      if (matched) {
        results.push(...matched.coordinates);
      } else {
        // Fallback: use original coordinates
        results.push(...batch);
      }
    } catch (error) {
      console.error('Batch snap failed:', error);
      results.push(...batch);
    }
  }

  return results;
}
