'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useActivityRecognition } from '@/hooks/useActivityRecognition';
import { matchRouteToRoads } from '@/utils/mapMatchingService';
import { API_CONFIG, trackApiUsage, getApiUsageStats, isWithinFreeTier } from '@/config/apiConfig';
import { saveRun, RunData, Split } from '@/utils/db';
import { calculateSplits, getSplitStats } from '@/utils/splitCalculator';
import { useAudioFeedback } from '@/hooks/useAudioFeedback';
import RunHistory from './RunHistory';
import RunCharts from './RunCharts';
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
  const [elevationGain, setElevationGain] = useState(0); // em metros
  const [elevationLoss, setElevationLoss] = useState(0); // em metros
  const [isProcessingRoute, setIsProcessingRoute] = useState(false);
  const [routeMatched, setRouteMatched] = useState(false);
  const lastElevationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const endTimeRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [apiUsageStats, setApiUsageStats] = useState(getApiUsageStats());
  const [splits, setSplits] = useState<Split[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const [maxSpeed, setMaxSpeed] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [viewingRun, setViewingRun] = useState<RunData | null>(null);
  const [isPausedManually, setIsPausedManually] = useState(false);
  const pauseStartTimeRef = useRef<number | null>(null);
  const totalPausedTimeRef = useRef<number>(0); // Total tempo pausado em ms
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [showStats, setShowStats] = useState(true); // Toggle para mostrar/esconder stats durante corrida

  // Audio Feedback Hook
  const audioFeedback = useAudioFeedback({
    enabled: audioEnabled,
    intervalKm: 1,
    announceDistance: true,
    announcePace: true,
    announceTime: true,
    announcePause: true,
  });

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

  // Activity Recognition (pausa automática inteligente)
  const { activityState, isPaused: autoPaused, isMoving } = useActivityRecognition(
    position?.speed || null
  );

  // Inicia tracking (rastreamento livre)
  const startTracking = () => {
    // Inicia o cronômetro
    startTimeRef.current = Date.now();
    totalPausedTimeRef.current = 0;
    setElapsedTime(0);
    setIsPausedManually(false);

    timerIntervalRef.current = setInterval(() => {
      if (startTimeRef.current && !isPausedManually) {
        const elapsed = Date.now() - startTimeRef.current - totalPausedTimeRef.current;
        setElapsedTime(Math.floor(elapsed / 1000));
      }
    }, 1000);

    // Inicia o rastreamento GPS
    startGeoTracking();

    // Reset audio tracking
    audioFeedback.resetTracking();

    // Anúncio de início
    audioFeedback.announceStart();
  };

  // Pausa manual durante corrida
  const handlePause = () => {
    setIsPausedManually(true);
    pauseStartTimeRef.current = Date.now();
    audioFeedback.announcePause();
  };

  // Retoma corrida após pausa
  const handleResume = () => {
    if (pauseStartTimeRef.current) {
      const pauseDuration = Date.now() - pauseStartTimeRef.current;
      totalPausedTimeRef.current += pauseDuration;
      pauseStartTimeRef.current = null;
    }
    setIsPausedManually(false);
    audioFeedback.announceResume();
  };

  // Para tracking (mantém dados para análise)
  const handleStopTracking = () => {
    stopTracking();

    // Marca tempo de fim
    endTimeRef.current = Date.now();

    // Para o cronômetro
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    // Calcula splits
    if (startTimeRef.current && endTimeRef.current && pathCoordinates.length > 0) {
      const calculatedSplits = calculateSplits(
        pathCoordinates,
        startTimeRef.current,
        endTimeRef.current
      );
      setSplits(calculatedSplits);
    }

    // Anúncio de fim
    audioFeedback.announceStop(totalDistance / 1000, elapsedTime);

    // Mostra resumo
    setShowSummary(true);
  };

  // Processa trajeto com Map Matching API (correção profissional)
  const matchRouteToMap = async () => {
    // Check if API is enabled
    if (!API_CONFIG.MAP_MATCHING.enabled) {
      alert('⚠️ Map Matching está desabilitado.\n\nEdite config/apiConfig.ts para ativar.');
      return;
    }

    if (pathCoordinates.length < 2) {
      alert('Trajeto muito curto para processar');
      return;
    }

    // Show warning about API usage
    if (API_CONFIG.MAP_MATCHING.showWarning) {
      const stats = getApiUsageStats();
      const withinFreeTier = isWithinFreeTier();
      const count = stats.mapMatching.count;
      const limit = API_CONFIG.MAP_MATCHING.cost.freeTier;

      const message = withinFreeTier
        ? `🗺️ Map Matching API (Mapbox)\n\n` +
          `📊 Uso este mês: ${count}/${limit.toLocaleString()} (${((count / limit) * 100).toFixed(1)}%)\n` +
          `💰 Custo: $0 (dentro do free tier)\n\n` +
          `Esta API corrige o trajeto para seguir ruas reais.\n\n` +
          `Continuar?`
        : `⚠️ ATENÇÃO: Acima do Free Tier!\n\n` +
          `📊 Uso: ${count}/${limit.toLocaleString()}\n` +
          `💰 Custo estimado: $${stats.mapMatching.totalCost.toFixed(2)}\n\n` +
          `Continuar mesmo assim?`;

      if (!confirm(message)) {
        return;
      }
    }

    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!mapboxToken) return;

    setIsProcessingRoute(true);

    try {
      const matched = await matchRouteToRoads(pathCoordinates, mapboxToken, {
        overview: 'full',
        radiuses: pathCoordinates.map(() => 25),
      });

      if (matched && matched.coordinates.length > 0) {
        // Track API usage
        trackApiUsage('mapMatching', 1);
        setApiUsageStats(getApiUsageStats()); // Update stats display

        // Atualiza trajeto com versão corrigida
        setPathCoordinates(matched.coordinates);
        setTotalDistance(matched.distance);
        setRouteMatched(true);

        // Atualiza visualização
        const pathSource = map.current?.getSource('path-line') as mapboxgl.GeoJSONSource;
        if (pathSource) {
          pathSource.setData({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: matched.coordinates,
            },
            properties: {},
          });
        }

        const updatedStats = getApiUsageStats();
        alert(
          `✅ Trajeto corrigido!\n\n` +
          `🎯 Confiança: ${(matched.confidence * 100).toFixed(0)}%\n` +
          `📊 Usos este mês: ${updatedStats.mapMatching.count}/${API_CONFIG.MAP_MATCHING.cost.freeTier.toLocaleString()}`
        );
      } else {
        alert('❌ Não foi possível corrigir o trajeto');
      }
    } catch (error) {
      console.error('Erro ao processar trajeto:', error);
      alert('Erro ao processar trajeto');
    } finally {
      setIsProcessingRoute(false);
    }
  };

  // Salva corrida no IndexedDB
  const handleSaveRun = async () => {
    if (!startTimeRef.current || !endTimeRef.current) {
      alert('Erro: dados da corrida incompletos');
      return;
    }

    try {
      const runData: Omit<RunData, 'id'> = {
        timestamp: startTimeRef.current,
        date: new Date(startTimeRef.current).toLocaleString('pt-BR'),
        duration: elapsedTime,
        distance: totalDistance,
        coordinates: pathCoordinates,
        elevationGain,
        elevationLoss,
        averagePace: totalDistance > 0 ? (elapsedTime / 60) / (totalDistance / 1000) : 0,
        averageSpeed: elapsedTime > 0 ? (totalDistance / 1000) / (elapsedTime / 3600) : 0,
        maxSpeed,
        splits,
        routeMatched,
      };

      await saveRun(runData);
      alert('✅ Corrida salva com sucesso!');
      handleReset();
    } catch (error) {
      console.error('Erro ao salvar corrida:', error);
      alert('❌ Erro ao salvar corrida');
    }
  };

  // Descarta corrida e limpa dados
  const handleDiscardRun = () => {
    if (confirm('Descartar esta corrida? Esta ação não pode ser desfeita.')) {
      handleReset();
    }
  };

  // Visualiza uma corrida salva
  const handleViewRun = (run: RunData) => {
    setViewingRun(run);
    setShowHistory(false);

    // Renderiza o trajeto no mapa
    if (map.current) {
      const pathSource = map.current.getSource('path-line') as mapboxgl.GeoJSONSource;
      if (pathSource) {
        pathSource.setData({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: run.coordinates,
          },
          properties: {},
        });
      }

      // Centra mapa no primeiro ponto
      if (run.coordinates.length > 0) {
        map.current.flyTo({
          center: run.coordinates[0],
          zoom: 15,
          duration: 2000,
        });
      }
    }

    // Atualiza estados para mostrar dados
    setPathCoordinates(run.coordinates);
    setTotalDistance(run.distance);
    setElapsedTime(run.duration);
    setElevationGain(run.elevationGain);
    setElevationLoss(run.elevationLoss);
    setSplits(run.splits);
    setMaxSpeed(run.maxSpeed);
    setRouteMatched(run.routeMatched);
    setShowSummary(true);
  };

  // Limpa dados e reinicia
  const handleReset = () => {
    setPathCoordinates([]);
    setTotalDistance(0);
    setElapsedTime(0);
    setElevationGain(0);
    setElevationLoss(0);
    setRouteMatched(false);
    setSplits([]);
    setShowSummary(false);
    setMaxSpeed(0);
    setIsPausedManually(false);
    startTimeRef.current = null;
    endTimeRef.current = null;
    pauseStartTimeRef.current = null;
    totalPausedTimeRef.current = 0;

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
      style: 'mapbox://styles/mapbox/dark-v11', // Dark theme - NIGHT RUN
      center: initialCenter,
      zoom: 18, // Zoom adequado
      pitch: 45, // Ângulo suave e clean
      bearing: 0,
      attributionControl: false,
      antialias: true,
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

      // Add path line layer - minimalista e delicado
      map.current?.addLayer({
        id: 'path-line-glow',
        type: 'line',
        source: 'path-line',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#10b981',
          'line-width': 8,
          'line-opacity': 0.3,
          'line-blur': 2,
        },
      });

      // Add main path line layer - linha clean
      map.current?.addLayer({
        id: 'path-line-layer',
        type: 'line',
        source: 'path-line',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#10b981',
          'line-width': 4,
          'line-opacity': 0.9,
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

  // Audio announcements for distance milestones
  useEffect(() => {
    if (isTracking && !isPausedManually && totalDistance > 0 && elapsedTime > 0) {
      const distanceKm = totalDistance / 1000;
      const paceMinPerKm = elapsedTime > 0 ? (elapsedTime / 60) / distanceKm : 0;

      audioFeedback.announceDistance(distanceKm, paceMinPerKm, elapsedTime);
    }
  }, [totalDistance, isTracking, isPausedManually, elapsedTime]);

  // Update position on map when GPS position changes
  useEffect(() => {
    if (!position || !map.current || !mapLoaded) return;

    const { latitude, longitude, accuracy: posAccuracy, heading, speed } = position;

    // Track max speed
    if (speed !== null && speed > maxSpeed) {
      setMaxSpeed(speed);
    }

    // Criar ou atualizar marker com SETA DIRECIONAL (SEMPRE, mesmo com GPS ruim)
    if (!marker.current && map.current) {
      // Criar elemento da seta
      const el = document.createElement('div');
      el.style.width = '40px';
      el.style.height = '40px';
      el.style.position = 'relative';
      el.style.zIndex = '1000';

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
      })
        .setLngLat([longitude, latitude])
        .addTo(map.current);

      // Aplicar rotação inicial
      if (heading !== null && heading !== undefined) {
        try {
          if (typeof marker.current.setRotation === 'function') {
            marker.current.setRotation(heading);
          } else {
            // Fallback: usar CSS transform
            el.style.transform = `rotate(${heading}deg)`;
          }
        } catch (e) {
          console.warn('Failed to set marker rotation:', e);
        }
      }

      console.log('✅ Marker created at:', [longitude, latitude], 'heading:', heading);
    } else if (marker.current) {
      // Atualizar posição
      marker.current.setLngLat([longitude, latitude]);

      // Rotacionar seta baseado no heading
      if (heading !== null && heading !== undefined) {
        try {
          if (typeof marker.current.setRotation === 'function') {
            marker.current.setRotation(heading);
          } else {
            // Fallback: usar CSS transform no elemento
            const markerElement = marker.current.getElement();
            markerElement.style.transform = `rotate(${heading}deg)`;
          }
        } catch (e) {
          console.warn('Failed to update marker rotation:', e);
        }
      }
    }

    // VALIDAÇÃO: Ignorar atualização do PATH com precisão ruim (> 30m)
    // Mas o marker ainda é mostrado para o usuário ver onde está
    if (posAccuracy && posAccuracy > 30) {
      console.warn(`GPS precision too low: ${posAccuracy.toFixed(1)}m - skipping path update`);
      return;
    }

    // NÃO registra pontos se estiver pausado manualmente
    if (isPausedManually) {
      return;
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
    if (heading !== null && heading !== undefined && isTracking) {
      map.current.easeTo({
        center: [longitude, latitude],
        bearing: heading,
        zoom: 18,
        pitch: 45,
        duration: 1000,
        essential: true,
      });
    } else {
      map.current.easeTo({
        center: [longitude, latitude],
        duration: 1000,
        essential: true,
      });
    }

    // Callback using ref to avoid dependency issues
    if (onLocationUpdateRef.current && posAccuracy) {
      onLocationUpdateRef.current(latitude, longitude, posAccuracy);
    }
  }, [position, mapLoaded]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Hamburger Menu Button - Top Left */}
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="absolute top-6 left-6 z-[100] bg-black/80 hover:bg-black/90 backdrop-blur-md text-white font-bold p-3 rounded-xl transition-all duration-200 shadow-lg border border-white/20"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {showMenu ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Slide Menu */}
      {showMenu && (
        <>
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm z-[90]"
            onClick={() => setShowMenu(false)}
          />

          {/* Menu Panel - Left Side */}
          <div className="absolute top-0 left-0 w-72 h-full bg-black/95 backdrop-blur-xl z-[95] border-r border-white/10 overflow-y-auto">
            <div className="p-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-lg font-bold text-white">Menu</h2>
                <button
                  onClick={() => setShowMenu(false)}
                  className="text-white/40 hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Audio Control */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                    <span className="text-sm text-white">Áudio</span>
                  </div>
                  <button
                    onClick={() => setAudioEnabled(!audioEnabled)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      audioEnabled ? 'bg-green-500' : 'bg-white/20'
                    }`}
                  >
                    <span
                      className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                        audioEnabled ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                {audioFeedback.isSpeaking && (
                  <div className="text-xs text-green-400">Falando...</div>
                )}
              </div>

              <div className="h-px bg-white/10 mb-4"></div>

              {/* Stats Toggle (durante corrida) */}
              {isTracking && (
                <>
                  <div className="mb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <svg className="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        <span className="text-sm text-white">Stats</span>
                      </div>
                      <button
                        onClick={() => setShowStats(!showStats)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          showStats ? 'bg-green-500' : 'bg-white/20'
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                            showStats ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                  <div className="h-px bg-white/10 mb-4"></div>
                </>
              )}

              {/* API Usage */}
              {API_CONFIG.MAP_MATCHING.enabled && (
                <>
                  <div className="mb-4">
                    <div className="flex items-center gap-3 mb-3">
                      <svg className="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                      <span className="text-sm text-white">API Usage</span>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-white/40">Map Matching</span>
                      <span className="text-xs text-white">
                        {apiUsageStats.mapMatching.count}/{(API_CONFIG.MAP_MATCHING.cost.freeTier / 1000).toFixed(0)}K
                      </span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-1">
                      <div
                        className="h-1 rounded-full bg-green-500 transition-all"
                        style={{
                          width: `${Math.min(
                            (apiUsageStats.mapMatching.count / API_CONFIG.MAP_MATCHING.cost.freeTier) * 100,
                            100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="h-px bg-white/10 mb-4"></div>
                </>
              )}

              {/* History Button */}
              {!isTracking && !showSummary && (
                <button
                  onClick={() => {
                    setShowHistory(true);
                    setShowMenu(false);
                  }}
                  className="w-full bg-white/10 hover:bg-white/20 text-white px-4 py-3 rounded-xl transition-all flex items-center gap-3 text-sm border border-white/10"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Histórico</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* History Modal */}
      {showHistory && (
        <RunHistory
          onClose={() => setShowHistory(false)}
          onViewRun={handleViewRun}
        />
      )}

      {/* Paused Banner */}
      {isTracking && isPausedManually && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-20 w-full max-w-md px-4">
          <div className="bg-black/80 backdrop-blur-md rounded-xl px-6 py-3 border border-white/20">
            <div className="text-center text-white text-sm">
              Pausado
            </div>
          </div>
        </div>
      )}

      {/* Stats panel - Running metrics */}
      {isTracking && position && !isPausedManually && showStats && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-10 w-full max-w-sm px-4">
          <div className="bg-black/80 backdrop-blur-md rounded-xl px-4 py-3 border border-white/10">
            {/* Timer */}
            <div className="text-center mb-3 pb-3 border-b border-white/10">
              <div className="text-3xl font-bold text-white">
                {formatTime(elapsedTime)}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              {/* Distance */}
              <div>
                <div className="text-xs text-white/40 mb-1">Distância</div>
                <div className="text-lg font-bold text-white">
                  {(totalDistance / 1000).toFixed(2)}
                </div>
              </div>

              {/* Pace */}
              <div>
                <div className="text-xs text-white/40 mb-1">Pace</div>
                <div className="text-lg font-bold text-white">
                  {position.speed !== null ? calculatePace(position.speed) : '--:--'}
                </div>
              </div>

              {/* Speed */}
              <div>
                <div className="text-xs text-white/40 mb-1">Vel</div>
                <div className="text-lg font-bold text-white">
                  {position.speed !== null ? (position.speed * 3.6).toFixed(1) : '0'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GPS Accuracy indicator - Enhanced (só mostra se stats estiver visível) */}
      {isTracking && accuracy && showStats && (
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

      {/* Summary Screen - Post Run */}
      {showSummary && pathCoordinates.length > 0 && (
        <div className="absolute inset-0 bg-black/95 z-50 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-6">
            <h2 className="text-xl font-bold text-white mb-6 text-center">Resumo da Corrida</h2>

            {/* Main Stats */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                <div className="text-xs text-white/40 uppercase mb-1">Distância</div>
                <div className="text-2xl font-bold text-white">{(totalDistance / 1000).toFixed(2)}</div>
                <div className="text-xs text-white/40">km</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                <div className="text-xs text-white/40 uppercase mb-1">Tempo</div>
                <div className="text-2xl font-bold text-white">{formatTime(elapsedTime)}</div>
                <div className="text-xs text-white/40">hh:mm:ss</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                <div className="text-xs text-white/40 uppercase mb-1">Pace Médio</div>
                <div className="text-2xl font-bold text-white">
                  {totalDistance > 0 ? calculatePace((totalDistance / elapsedTime)) : '--:--'}
                </div>
                <div className="text-xs text-white/40">min/km</div>
              </div>
            </div>

            {/* Secondary Stats */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="text-xs text-white/40 mb-1">Velocidade Máxima</div>
                <div className="text-lg font-bold text-white">{(maxSpeed * 3.6).toFixed(1)} km/h</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="text-xs text-white/40 mb-1">Ganho de Elevação</div>
                <div className="text-lg font-bold text-white">{elevationGain.toFixed(0)} m</div>
              </div>
            </div>

            {/* Splits */}
            {splits.length > 0 && (
              <>
                <div className="mb-6">
                  <h3 className="text-lg font-bold text-white mb-3">Splits por KM</h3>
                  <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                    <div className="grid grid-cols-3 gap-2 p-3 bg-white/5 border-b border-white/10 text-xs text-white/40 uppercase font-bold">
                      <div>KM</div>
                      <div className="text-center">Tempo</div>
                      <div className="text-right">Pace</div>
                    </div>
                    {splits.map((split, idx) => {
                      const splitStats = getSplitStats(splits);
                      const isBest = split.km === splitStats.bestKm;
                      const isWorst = split.km === splitStats.worstKm;

                      return (
                        <div
                          key={idx}
                          className={`grid grid-cols-3 gap-2 p-3 border-b border-white/5 ${
                            isBest ? 'bg-green-500/10' : isWorst ? 'bg-red-500/10' : ''
                          }`}
                        >
                          <div className="text-white text-sm">
                            KM {split.km}
                          </div>
                          <div className="text-center text-white/60 text-sm">
                            {Math.floor(split.time / 60)}:{(split.time % 60).toFixed(0).padStart(2, '0')}
                          </div>
                          <div className={`text-right text-sm ${
                            isBest ? 'text-green-400' : isWorst ? 'text-red-400' : 'text-white'
                          }`}>
                            {split.pace}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Charts */}
                <div className="mb-6">
                  <RunCharts splits={splits} />
                </div>
              </>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 mb-4">
              <button
                onClick={matchRouteToMap}
                disabled={isProcessingRoute || routeMatched}
                className={`flex-1 ${routeMatched ? 'bg-white/10 border-green-500/40' : 'bg-white/10 hover:bg-white/20 border-white/20'} ${isProcessingRoute ? 'opacity-50 cursor-wait' : ''} text-white px-6 py-3 rounded-xl transition-all border text-sm flex items-center justify-center gap-2`}
              >
                {isProcessingRoute ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                  </>
                ) : routeMatched ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Trajeto Corrigido
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    Corrigir Trajeto
                  </>
                )}
              </button>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSaveRun}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-xl transition-all border border-green-500/40 text-sm flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                Salvar Corrida
              </button>
              <button
                onClick={handleDiscardRun}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-xl transition-all border border-red-500/40 text-sm flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Control panel - Advanced */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-10">
        {isTracking ? (
          // Durante corrida: botões Pausar/Retomar e Parar
          <div className="flex gap-3">
            {isPausedManually ? (
              // Botão Retomar
              <button
                onClick={handleResume}
                className="bg-black/80 hover:bg-black/90 backdrop-blur-md text-white px-6 py-3 rounded-xl transition-all border border-green-500/40 flex items-center gap-2 text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Retomar
              </button>
            ) : (
              // Botão Pausar
              <button
                onClick={handlePause}
                className="bg-black/80 hover:bg-black/90 backdrop-blur-md text-white px-6 py-3 rounded-xl transition-all border border-white/20 flex items-center gap-2 text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Pausar
              </button>
            )}

            {/* Botão Parar */}
            <button
              onClick={handleStopTracking}
              className="bg-black/80 hover:bg-black/90 backdrop-blur-md text-white px-6 py-3 rounded-xl transition-all border border-red-500/40 flex items-center gap-2 text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
              Parar
            </button>
          </div>
        ) : !showSummary && pathCoordinates.length === 0 ? (
          // Início: botão Iniciar
          <button
            onClick={startTracking}
            className="bg-black/80 hover:bg-black/90 backdrop-blur-md text-white px-8 py-3 rounded-xl transition-all border border-green-500/40 flex items-center gap-2 text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Iniciar Corrida
          </button>
        ) : null}
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
