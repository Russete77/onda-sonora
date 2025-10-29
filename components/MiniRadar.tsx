'use client';

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

interface MiniRadarProps {
  currentPosition: [number, number] | null;
  routeCoordinates: [number, number][];
  heading?: number;
}

export default function MiniRadar({ currentPosition, routeCoordinates, heading = 0 }: MiniRadarProps) {
  const radarContainer = useRef<HTMLDivElement>(null);
  const radarMap = useRef<mapboxgl.Map | null>(null);
  const radarMarker = useRef<mapboxgl.Marker | null>(null);

  // Initialize mini radar map
  useEffect(() => {
    if (!radarContainer.current || radarMap.current) return;

    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!mapboxToken) return;

    mapboxgl.accessToken = mapboxToken;

    radarMap.current = new mapboxgl.Map({
      container: radarContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: currentPosition || [0, 0],
      zoom: 14,
      pitch: 0,
      bearing: 0,
      interactive: false, // Radar não é interativo
      attributionControl: false,
    });

    radarMap.current.on('load', () => {
      // Add route source
      radarMap.current?.addSource('radar-route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: routeCoordinates,
          },
          properties: {},
        },
      });

      // Add route layers with glow
      radarMap.current?.addLayer({
        id: 'radar-route-glow',
        type: 'line',
        source: 'radar-route',
        paint: {
          'line-color': '#00ff88',
          'line-width': 8,
          'line-opacity': 0.4,
          'line-blur': 3,
        },
      });

      radarMap.current?.addLayer({
        id: 'radar-route-line',
        type: 'line',
        source: 'radar-route',
        paint: {
          'line-color': '#00ff88',
          'line-width': 4,
          'line-opacity': 1,
        },
      });

      // Create runner marker
      if (currentPosition) {
        const el = document.createElement('div');
        el.style.width = '12px';
        el.style.height = '12px';
        el.style.borderRadius = '50%';
        el.style.backgroundColor = '#00ff88';
        el.style.border = '2px solid #ffffff';
        el.style.boxShadow = '0 0 10px rgba(0, 255, 136, 0.8)';

        radarMarker.current = new mapboxgl.Marker({
          element: el,
          anchor: 'center',
        })
          .setLngLat(currentPosition)
          .addTo(radarMap.current);
      }
    });

    return () => {
      if (radarMap.current) {
        radarMap.current.remove();
        radarMap.current = null;
      }
    };
  }, []);

  // Update route when it changes
  useEffect(() => {
    if (!radarMap.current || routeCoordinates.length === 0) return;

    const source = radarMap.current.getSource('radar-route') as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: routeCoordinates,
        },
        properties: {},
      });

      // Fit map to route bounds
      if (routeCoordinates.length > 1) {
        const bounds = routeCoordinates.reduce(
          (bounds, coord) => bounds.extend(coord as [number, number]),
          new mapboxgl.LngLatBounds(routeCoordinates[0], routeCoordinates[0])
        );
        radarMap.current?.fitBounds(bounds, { padding: 20, duration: 0 });
      }
    }
  }, [routeCoordinates]);

  // Update runner position
  useEffect(() => {
    if (!radarMap.current || !currentPosition) return;

    // Update or create marker
    if (radarMarker.current) {
      radarMarker.current.setLngLat(currentPosition);
    } else {
      const el = document.createElement('div');
      el.style.width = '12px';
      el.style.height = '12px';
      el.style.borderRadius = '50%';
      el.style.backgroundColor = '#00ff88';
      el.style.border = '2px solid #ffffff';
      el.style.boxShadow = '0 0 10px rgba(0, 255, 136, 0.8)';

      radarMarker.current = new mapboxgl.Marker({
        element: el,
        anchor: 'center',
      })
        .setLngLat(currentPosition)
        .addTo(radarMap.current);
    }

    // Center map on runner
    radarMap.current.setCenter(currentPosition);

    // Rotate map based on heading
    if (heading !== null && heading !== undefined) {
      radarMap.current.setBearing(heading);
    }
  }, [currentPosition, heading]);

  return (
    <div className="relative">
      {/* Circular mask */}
      <div className="w-36 h-36 rounded-full overflow-hidden border-4 border-green-500 shadow-2xl shadow-green-500/50 relative">
        <div ref={radarContainer} className="absolute inset-0 w-full h-full" />

        {/* Radar scan line animation */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="radar-scan"></div>
        </div>

        {/* Center dot (runner indicator) */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10">
          <div className="w-3 h-3 bg-green-400 rounded-full border-2 border-white shadow-lg animate-pulse"></div>
        </div>
      </div>

      {/* Radar label */}
      <div className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 bg-black/80 backdrop-blur-md px-3 py-1 rounded-lg border border-green-500/50">
        <span className="text-xs text-green-400 font-bold">RADAR</span>
      </div>
    </div>
  );
}
