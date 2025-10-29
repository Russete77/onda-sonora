'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { useGeolocation } from '@/hooks/useGeolocation';
import MiniRadar from './MiniRadar';
import 'mapbox-gl/dist/mapbox-gl.css';

interface MapboxTrackerProps {
  onLocationUpdate?: (lat: number, lng: number, accuracy: number) => void;
  onTrackingChange?: (isTracking: boolean) => void;
}

export default function MapboxTracker({ onLocationUpdate, onTrackingChange }: MapboxTrackerProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const marker = useRef<mapboxgl.Marker | null>(null);
  const accuracyCircle = useRef<string | null>(null);
  const pathLine = useRef<string | null>(null);
  const onLocationUpdateRef = useRef(onLocationUpdate);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [pathCoordinates, setPathCoordinates] = useState<[number, number][]>([]);
  const [totalDistance, setTotalDistance] = useState(0); // em metros
  const [elapsedTime, setElapsedTime] = useState(0); // em segundos
  const startTimeRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Route planning states
  const [plannedRoute, setPlannedRoute] = useState<[number, number][]>([]);
  const [isRoutePlanned, setIsRoutePlanned] = useState(false);
  const [selectedDistance, setSelectedDistance] = useState<number | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);

  // Keep ref updated
  useEffect(() => {
    onLocationUpdateRef.current = onLocationUpdate;
  }, [onLocationUpdate]);

  // Calculate distance between two coordinates using Haversine formula
  const calculateDistance = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number => {
    const R = 6371e3; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  };

  // Calculate pace (min/km) from speed (m/s)
  const calculatePace = (speedInMetersPerSecond: number): string => {
    // Threshold para corrida: 2.0 m/s = 7.2 km/h (velocidade mínima de corrida)
    if (speedInMetersPerSecond < 2.0) return '--:--';

    const speedInKmPerHour = speedInMetersPerSecond * 3.6;
    const paceInMinutesPerKm = 60 / speedInKmPerHour;

    // Limitar pace máximo a 10:00 min/km para evitar valores absurdos
    if (paceInMinutesPerKm > 10) return '--:--';

    const minutes = Math.floor(paceInMinutesPerKm);
    const seconds = Math.floor((paceInMinutesPerKm - minutes) * 60);

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Format elapsed time (seconds) to HH:MM:SS
  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  // Hook de geolocalização com configurações otimizadas
  const { position, error, accuracy, startTracking: startGeoTracking, stopTracking, isTracking } = useGeolocation({
    enableHighAccuracy: true,
    timeout: 5000,
    maximumAge: 0,
    distanceFilter: 0.2, // Update every 0.2 meter - alta precisão para capturar curvas
  });

  // Custom startTracking para limpar rota planejada do mapa grande
  const startTracking = () => {
    // Limpa a rota planejada do MAPA GRANDE (não do radar)
    const pathSource = map.current?.getSource('path-line') as mapboxgl.GeoJSONSource;
    if (pathSource) {
      pathSource.setData({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [], // LIMPA a rota planejada
        },
        properties: {},
      });
    }

    // Inicia o cronômetro
    startTimeRef.current = Date.now();
    setElapsedTime(0);
    timerIntervalRef.current = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);

    // Inicia o rastreamento GPS
    startGeoTracking();
  };

  // Reset tracking data when stopping
  const handleStopTracking = () => {
    stopTracking();
    setPathCoordinates([]);
    setTotalDistance(0);

    // Para o cronômetro
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    startTimeRef.current = null;
    setElapsedTime(0);

    // Clear path on map
    const pathSource = map.current?.getSource('path-line') as mapboxgl.GeoJSONSource;
    if (pathSource) {
      pathSource.setData({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [],
        },
        properties: {},
      });
    }
  };

  // Create circular route from current position
  const createCircularRoute = async (distanceKm: number) => {
    setIsLoadingRoute(true);
    setSelectedDistance(distanceKm);

    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!mapboxToken) {
      setIsLoadingRoute(false);
      return;
    }

    try {
      // Get current position
      const getCurrentPos = (): Promise<GeolocationPosition> => {
        return new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 5000,
          });
        });
      };

      const pos = await getCurrentPos();
      const startLng = pos.coords.longitude;
      const startLat = pos.coords.latitude;

      // Calculate waypoints for circular route (perfect track-like loop)
      // SEMPRE começando da posição atual do dispositivo
      const radiusKm = distanceKm / (2 * Math.PI); // Approximate radius for desired distance
      const numPoints = 12; // 12 waypoints for ultra-smooth circular route
      const waypoints: [number, number][] = [];

      // IMPORTANTE: Adiciona o ponto inicial (posição atual do dispositivo)
      waypoints.push([startLng, startLat]);

      // Create waypoints in perfect circle around start point
      for (let i = 1; i <= numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;
        const latOffset = radiusKm * Math.cos(angle) / 111; // 1 degree lat ≈ 111 km
        const lngOffset = radiusKm * Math.sin(angle) / (111 * Math.cos((startLat * Math.PI) / 180));

        waypoints.push([startLng + lngOffset, startLat + latOffset]);
      }

      // IMPORTANTE: Add ponto inicial no final para fechar o loop e voltar exatamente ao ponto de partida
      waypoints.push([startLng, startLat]);

      // Create route through waypoints
      const coordinates = waypoints.map(w => `${w[0]},${w[1]}`).join(';');
      const routeRes = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/walking/${coordinates}?geometries=geojson&overview=full&access_token=${mapboxToken}`
      );
      const routeData = await routeRes.json();

      if (routeData.routes?.[0]?.geometry?.coordinates) {
        const routeCoords = routeData.routes[0].geometry.coordinates as [number, number][];
        setPlannedRoute(routeCoords);
        setIsRoutePlanned(true);

        // Draw route on main map
        const routeSource = map.current?.getSource('path-line') as mapboxgl.GeoJSONSource;
        if (routeSource) {
          routeSource.setData({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: routeCoords,
            },
            properties: {},
          });
        }

        // Center map on start position and fit route
        if (routeCoords.length > 1) {
          // First center on user position
          map.current?.setCenter([startLng, startLat]);

          // Then fit bounds with padding
          const bounds = routeCoords.reduce(
            (bounds, coord) => bounds.extend(coord),
            new mapboxgl.LngLatBounds(routeCoords[0], routeCoords[0])
          );
          map.current?.fitBounds(bounds, { padding: 80, duration: 1000 });
        }
      }
    } catch (error) {
      console.error('Erro ao criar rota:', error);
      alert('Erro ao criar rota circular. Verifique se a localização está ativada!');
    } finally {
      setIsLoadingRoute(false);
    }
  };

  // Initialize Mapbox
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!mapboxToken) {
      console.error('Mapbox token não encontrado. Configure NEXT_PUBLIC_MAPBOX_TOKEN no .env.local');
      return;
    }

    mapboxgl.accessToken = mapboxToken;

    // Get user's current location to center map
    let initialCenter: [number, number] = [-46.6333, -23.5505]; // Default: São Paulo

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          initialCenter = [position.coords.longitude, position.coords.latitude];

          // Update map center if already initialized
          if (map.current) {
            map.current.setCenter(initialCenter);
          }
        },
        (error) => {
          console.log('Using default location:', error.message);
        },
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0,
        }
      );
    }

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11', // Dark theme para look moderno
      center: initialCenter,
      zoom: 18, // Zoom bem próximo para corredor
      pitch: 50, // 3D view angle mais acentuado
      bearing: 0,
      attributionControl: false,
    });

    // Add controls
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.current.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true,
        },
        trackUserLocation: true,
        showUserHeading: true,
      }),
      'top-right'
    );

    map.current.on('load', () => {
      // Force map resize to get correct dimensions
      setTimeout(() => {
        map.current?.resize();
        setMapLoaded(true);
      }, 100);

      // Add accuracy circle source
      map.current?.addSource('accuracy-circle', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [0, 0],
          },
          properties: {},
        },
      });

      // Add path line source
      map.current?.addSource('path-line', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [],
          },
          properties: {},
        },
      });

      // Add path line layer with outer glow
      map.current?.addLayer({
        id: 'path-line-outer-glow',
        type: 'line',
        source: 'path-line',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#00ff88',
          'line-width': 20,
          'line-opacity': 0.15,
          'line-blur': 6,
        },
      });

      // Add path line layer with inner glow
      map.current?.addLayer({
        id: 'path-line-inner-glow',
        type: 'line',
        source: 'path-line',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#00ff88',
          'line-width': 15,
          'line-opacity': 0.4,
          'line-blur': 3,
        },
      });

      // Add main path line layer - dentro da largura da rua
      map.current?.addLayer({
        id: 'path-line-layer',
        type: 'line',
        source: 'path-line',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#00ff88',
          'line-width': 12,
          'line-opacity': 0.95,
        },
      });

      // Add accuracy circle layer
      map.current?.addLayer({
        id: 'accuracy-circle-layer',
        type: 'circle',
        source: 'accuracy-circle',
        paint: {
          'circle-radius': {
            stops: [
              [0, 0],
              [20, 100],
            ],
            base: 2,
          },
          'circle-color': '#00ff88',
          'circle-opacity': 0.1,
          'circle-stroke-color': '#00ff88',
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0.3,
        },
      });
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  // Notify parent when tracking state changes
  useEffect(() => {
    if (onTrackingChange) {
      onTrackingChange(isTracking);
    }
  }, [isTracking, onTrackingChange]);

  // Update position on map when GPS position changes
  useEffect(() => {
    if (!position || !map.current || !mapLoaded) return;

    const { latitude, longitude, accuracy: posAccuracy, heading } = position;

    // VALIDAÇÃO: Ignorar updates com precisão ruim (> 30m)
    if (posAccuracy && posAccuracy > 30) {
      console.warn(`GPS precision too low: ${posAccuracy.toFixed(1)}m - skipping update`);
      return;
    }

    // Criar ou atualizar marker com SETA DIRECIONAL
    if (!marker.current && map.current) {
      // Criar elemento da seta
      const el = document.createElement('div');
      el.style.width = '40px';
      el.style.height = '40px';
      el.style.position = 'relative';

      // SVG da seta apontando para cima (será rotacionado pelo heading)
      el.innerHTML = `
        <svg width="40" height="40" viewBox="0 0 40 40" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
          <defs>
            <linearGradient id="arrowGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style="stop-color:#00ff88;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#00cc66;stop-opacity:1" />
            </linearGradient>
          </defs>
          <!-- Círculo externo -->
          <circle cx="20" cy="20" r="18" fill="rgba(0, 255, 136, 0.2)" />
          <!-- Círculo interno -->
          <circle cx="20" cy="20" r="15" fill="#000000" stroke="url(#arrowGradient)" stroke-width="2" />
          <!-- Seta apontando para cima -->
          <path d="M 20 8 L 26 18 L 22 18 L 22 28 L 18 28 L 18 18 L 14 18 Z" fill="url(#arrowGradient)" />
        </svg>
      `;

      marker.current = new mapboxgl.Marker({
        element: el,
        anchor: 'center',
        rotationAlignment: 'map',
        pitchAlignment: 'map',
      })
        .setLngLat([longitude, latitude])
        .setRotation(heading || 0)
        .addTo(map.current);
    } else if (marker.current) {
      // Atualizar posição
      marker.current.setLngLat([longitude, latitude]);

      // Rotacionar seta baseado no heading usando API do Mapbox
      if (heading !== null && heading !== undefined) {
        marker.current.setRotation(heading);
      }
    }

    // Update accuracy circle
    if (posAccuracy) {
      const accuracyRadius = posAccuracy;
      const metersPerPixel = 156543.03392 * Math.cos((latitude * Math.PI) / 180) / Math.pow(2, map.current.getZoom());
      const radiusInPixels = accuracyRadius / metersPerPixel;

      const source = map.current.getSource('accuracy-circle') as mapboxgl.GeoJSONSource;
      if (source) {
        source.setData({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [longitude, latitude],
          },
          properties: {
            radius: radiusInPixels,
          },
        });
      }
    }

    // Update path using functional setState to avoid stale closures
    setPathCoordinates((prevPath) => {
      const newPathCoordinates: [number, number][] = [...prevPath, [longitude, latitude]];

      // Calculate distance increment if we have a previous point
      if (prevPath.length > 0) {
        const lastPoint = prevPath[prevPath.length - 1];
        const distanceIncrement = calculateDistance(
          lastPoint[1], // lat
          lastPoint[0], // lon
          latitude,
          longitude
        );

        // Update total distance
        setTotalDistance((prevDistance) => prevDistance + distanceIncrement);
      }

      // Update path source
      const pathSource = map.current?.getSource('path-line') as mapboxgl.GeoJSONSource;
      if (pathSource) {
        pathSource.setData({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: newPathCoordinates,
          },
          properties: {},
        });
      }

      return newPathCoordinates;
    });

    // Center map on user location with smooth animation
    map.current.easeTo({
      center: [longitude, latitude],
      duration: 1000,
      essential: true,
    });

    // Callback using ref to avoid dependency issues
    if (onLocationUpdateRef.current && posAccuracy) {
      onLocationUpdateRef.current(latitude, longitude, posAccuracy);
    }
  }, [position, mapLoaded]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Stats panel - Running metrics */}
      {isTracking && position && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-10 w-full max-w-md px-4">
          <div className="bg-gradient-to-br from-black/95 via-black/90 to-black/85 backdrop-blur-xl rounded-3xl px-5 py-4 shadow-2xl border-2 border-green-500/40">
            {/* Timer - Top row */}
            <div className="text-center mb-3 pb-2 border-b border-white/10">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider font-bold mb-1">
                Tempo
              </div>
              <div className="text-4xl font-black text-white leading-none tracking-tight">
                {formatTime(elapsedTime)}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {/* Distance */}
              <div className="text-center">
                <div className="text-[9px] text-gray-400 uppercase tracking-wider font-bold mb-1.5">
                  Distância
                </div>
                <div className="text-2xl font-black text-green-400 leading-none mb-0.5">
                  {(totalDistance / 1000).toFixed(2)}
                </div>
                <div className="text-[10px] text-green-400/60 font-semibold">km</div>
              </div>

              {/* Pace */}
              <div className="text-center border-x-2 border-white/20">
                <div className="text-[9px] text-gray-400 uppercase tracking-wider font-bold mb-1.5">
                  Pace
                </div>
                <div className="text-2xl font-black text-blue-400 leading-none mb-0.5">
                  {position.speed !== null
                    ? calculatePace(position.speed)
                    : '--:--'}
                </div>
                <div className="text-[10px] text-blue-400/60 font-semibold">min/km</div>
              </div>

              {/* Speed */}
              <div className="text-center">
                <div className="text-[9px] text-gray-400 uppercase tracking-wider font-bold mb-1.5">
                  Velocidade
                </div>
                <div className="text-2xl font-black text-purple-400 leading-none mb-0.5">
                  {position.speed !== null ? (position.speed * 3.6).toFixed(1) : '0.0'}
                </div>
                <div className="text-[10px] text-purple-400/60 font-semibold">km/h</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GPS Accuracy indicator - Enhanced */}
      {isTracking && accuracy && (
        <div className="absolute top-20 right-6 z-10">
          <div className={`backdrop-blur-md rounded-xl px-3 py-2 shadow-lg border-2 ${
            accuracy < 10
              ? 'bg-green-500/20 border-green-500/60'
              : accuracy < 20
              ? 'bg-yellow-500/20 border-yellow-500/60'
              : accuracy < 30
              ? 'bg-orange-500/20 border-orange-500/60'
              : 'bg-red-500/20 border-red-500/60'
          }`}>
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full animate-pulse ${
                  accuracy < 10
                    ? 'bg-green-500 shadow-lg shadow-green-500/50'
                    : accuracy < 20
                    ? 'bg-yellow-500 shadow-lg shadow-yellow-500/50'
                    : accuracy < 30
                    ? 'bg-orange-500 shadow-lg shadow-orange-500/50'
                    : 'bg-red-500 shadow-lg shadow-red-500/50'
                }`}
              ></div>
              <div className="flex flex-col">
                <div className="text-[10px] text-white/60 uppercase tracking-wider font-bold">GPS</div>
                <div className={`text-sm font-black ${
                  accuracy < 10
                    ? 'text-green-400'
                    : accuracy < 20
                    ? 'text-yellow-400'
                    : accuracy < 30
                    ? 'text-orange-400'
                    : 'text-red-400'
                }`}>
                  ±{accuracy.toFixed(0)}m
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mini Radar - Shows during tracking */}
      {isTracking && position && (
        <div className="absolute bottom-24 right-8 z-10">
          <MiniRadar
            currentPosition={[position.longitude, position.latitude]}
            routeCoordinates={plannedRoute.length > 0 ? plannedRoute : pathCoordinates}
            heading={position.heading || 0}
          />
        </div>
      )}

      {/* Control panel */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-10 max-w-lg w-full px-4">
        {!isTracking ? (
          <div className="space-y-3">
            {/* Route planning - Clean design */}
            {!isRoutePlanned ? (
              <div className="bg-black/70 backdrop-blur-lg rounded-2xl px-5 py-4 shadow-xl border border-white/10">
                <div className="text-center mb-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                    Escolha a distância
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[5, 10, 15].map((km) => (
                    <button
                      key={km}
                      onClick={() => createCircularRoute(km)}
                      disabled={isLoadingRoute}
                      className={`${
                        selectedDistance === km
                          ? 'bg-green-500 border-green-400'
                          : 'bg-white/5 border-white/20 hover:bg-white/10'
                      } ${
                        isLoadingRoute ? 'opacity-50 cursor-wait' : ''
                      } border-2 rounded-xl py-4 transition-all duration-200`}
                    >
                      <div className="text-2xl font-black text-white">{km}</div>
                      <div className="text-xs text-gray-400 font-semibold">km</div>
                    </button>
                  ))}
                </div>
                {isLoadingRoute && (
                  <div className="flex items-center justify-center gap-2 mt-3">
                    <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-green-500"></div>
                    <span className="text-xs text-gray-400">Criando rota...</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-black/70 backdrop-blur-lg rounded-2xl px-5 py-3 shadow-xl border border-green-500/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-green-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="text-sm text-white font-semibold">
                    Rota de {selectedDistance}km planejada
                  </span>
                </div>
                <button
                  onClick={() => {
                    setIsRoutePlanned(false);
                    setSelectedDistance(null);
                    setPlannedRoute([]);
                    const routeSource = map.current?.getSource('path-line') as mapboxgl.GeoJSONSource;
                    if (routeSource) {
                      routeSource.setData({
                        type: 'Feature',
                        geometry: { type: 'LineString', coordinates: [] },
                        properties: {},
                      });
                    }
                  }}
                  className="text-xs text-red-400 hover:text-red-300 font-semibold"
                >
                  Refazer
                </button>
              </div>
            )}

            {/* Start button */}
            <div className="flex justify-center">
              <button
                onClick={startTracking}
                className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold px-8 py-3 rounded-2xl transition-all duration-200 shadow-lg hover:shadow-green-500/50 flex items-center gap-2"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Iniciar Corrida
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <button
              onClick={handleStopTracking}
              className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold px-8 py-3 rounded-2xl transition-all duration-200 shadow-lg hover:shadow-red-500/50 flex items-center gap-2"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
                />
              </svg>
              Parar Corrida
            </button>
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 z-10 w-full max-w-md px-4">
          <div className="bg-red-500/90 backdrop-blur-md rounded-xl px-6 py-4 shadow-2xl border border-red-300/20">
            <div className="text-white font-medium text-center">{error}</div>
          </div>
        </div>
      )}
    </div>
  );
}
