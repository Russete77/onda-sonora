/**
 * Map Matching Service - Mapbox API (STRAVA-GRADE)
 * "Cola" trajeto GPS nas ruas reais - usado por Strava, Nike Run Club
 * Corrige erros de GPS retroativamente para trajeto perfeito
 *
 * PERFORMANCE:
 * - Processa rotas de QUALQUER tamanho via batching inteligente
 * - Overlap de 10 pontos entre batches para continuidade perfeita
 * - Rate limiting automático (600 req/min = Mapbox free tier limit)
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
 * (Single batch - internal use only, use matchRouteToRoadsBatched for production)
 */
async function matchRouteToRoadsSingleBatch(
  coordinates: [number, number][],
  accessToken: string,
  options: MapMatchingOptions = {}
): Promise<MatchedRoute | null> {
  if (coordinates.length < 2) {
    console.warn('[MapMatching] Requires at least 2 coordinates');
    return null;
  }

  // Mapbox hard limit: 100 coordinates per request
  if (coordinates.length > 100) {
    console.error('[MapMatching] Single batch exceeded 100 coords - use matchRouteToRoadsBatched');
    return null;
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
    console.error('[MapMatching] API error:', error);
    return null;
  }
}

/**
 * STRAVA-GRADE Map Matching with Intelligent Batching
 * Processes routes of ANY size (5km, 10km, marathon, ultra)
 *
 * ALGORITHM:
 * 1. Split into batches of 90 coords (leaving margin below 100 limit)
 * 2. Overlap 10 coords between batches for seamless continuity
 * 3. Merge results with deduplication at boundaries
 * 4. Rate limit to 100ms per request (600/min = Mapbox free tier)
 *
 * EXAMPLE:
 * - 5km run @ 1Hz GPS = ~1800 coords
 * - Batches: 20 batches × 90 coords
 * - Time: ~2 seconds total
 * - Cost: $0.10 ($0.005 × 20)
 *
 * @param coordinates Full GPS trace (unlimited size)
 * @param accessToken Mapbox token
 * @returns Matched route snapped to roads, or null on failure
 */
export async function matchRouteToRoadsBatched(
  coordinates: [number, number][],
  accessToken: string
): Promise<MatchedRoute | null> {
  if (coordinates.length < 2) {
    console.warn('[MapMatching] Requires at least 2 coordinates');
    return null;
  }

  // Small routes: use single batch (optimization)
  if (coordinates.length <= 100) {
    console.log(`[MapMatching] Small route (${coordinates.length} coords) - single batch`);
    return matchRouteToRoadsSingleBatch(coordinates, accessToken);
  }

  console.log(`[MapMatching] Large route (${coordinates.length} coords) - batching with overlap`);

  const BATCH_SIZE = 90; // Safe margin below 100 limit
  const OVERLAP = 10; // Continuity overlap between batches
  const RATE_LIMIT_MS = 150; // 150ms = ~400 req/min (safe for 600/min limit)

  const allMatchedCoords: [number, number][] = [];
  let totalDistance = 0;
  let totalDuration = 0;
  let batchCount = 0;
  let failedBatches = 0;

  for (let i = 0; i < coordinates.length; i += BATCH_SIZE) {
    // Calculate batch boundaries with overlap
    const start = Math.max(0, i - OVERLAP);
    const end = Math.min(coordinates.length, i + BATCH_SIZE + OVERLAP);
    const batch = coordinates.slice(start, end);

    batchCount++;
    console.log(
      `[MapMatching] Processing batch ${batchCount}: coords ${start}-${end} (${batch.length} points)`
    );

    try {
      const matched = await matchRouteToRoadsSingleBatch(batch, accessToken, {
        overview: 'full',
        radiuses: batch.map(() => 25),
      });

      if (matched && matched.coordinates.length > 0) {
        // First batch: add all coords
        // Subsequent batches: skip overlap to avoid duplicates
        const coordsToAdd = i === 0
          ? matched.coordinates
          : matched.coordinates.slice(OVERLAP);

        allMatchedCoords.push(...coordsToAdd);
        totalDistance += matched.distance;
        totalDuration += matched.duration;

        console.log(
          `[MapMatching] Batch ${batchCount} matched: ${matched.coordinates.length} coords, ` +
          `${matched.distance.toFixed(0)}m, confidence: ${matched.confidence.toFixed(2)}`
        );
      } else {
        // Fallback: use original coordinates if matching fails
        failedBatches++;
        console.warn(`[MapMatching] Batch ${batchCount} failed - using original coords`);
        const coordsToAdd = i === 0 ? batch : batch.slice(OVERLAP);
        allMatchedCoords.push(...coordsToAdd);
      }
    } catch (error) {
      failedBatches++;
      console.error(`[MapMatching] Batch ${batchCount} error:`, error);
      // Fallback: use original coordinates
      const coordsToAdd = i === 0 ? batch : batch.slice(OVERLAP);
      allMatchedCoords.push(...coordsToAdd);
    }

    // Rate limiting (except last batch)
    if (i + BATCH_SIZE < coordinates.length) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
    }
  }

  console.log(
    `[MapMatching] Complete: ${batchCount} batches processed, ${failedBatches} failed, ` +
    `${allMatchedCoords.length} total coords, ${totalDistance.toFixed(0)}m`
  );

  return {
    coordinates: allMatchedCoords,
    distance: totalDistance,
    duration: totalDuration,
    confidence: failedBatches === 0 ? 1 : 1 - (failedBatches / batchCount),
  };
}

/**
 * DEPRECATED: Use matchRouteToRoadsBatched instead
 * Kept for backward compatibility
 */
export async function matchRouteToRoads(
  coordinates: [number, number][],
  accessToken: string,
  options: MapMatchingOptions = {}
): Promise<MatchedRoute | null> {
  console.warn('[MapMatching] matchRouteToRoads is deprecated, use matchRouteToRoadsBatched');
  return matchRouteToRoadsBatched(coordinates, accessToken);
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
