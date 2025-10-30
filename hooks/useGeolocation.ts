'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { KalmanFilter } from '@/utils/kalmanFilter';

export interface GeolocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

interface UseGeolocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
  distanceFilter?: number; // Minimum distance in meters to trigger update
}

interface UseGeolocationReturn {
  position: GeolocationData | null;
  error: string | null;
  isLoading: boolean;
  accuracy: number | null;
  startTracking: () => void;
  stopTracking: () => void;
  isTracking: boolean;
}

export function useGeolocation(
  options: UseGeolocationOptions = {}
): UseGeolocationReturn {
  const {
    enableHighAccuracy = true,
    timeout = 5000,
    maximumAge = 0,
    distanceFilter = 0,
  } = options;

  const [position, setPosition] = useState<GeolocationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isTracking, setIsTracking] = useState<boolean>(false);

  const watchIdRef = useRef<number | null>(null);
  const lastPositionRef = useRef<GeolocationData | null>(null);

  // Kalman Filter for professional-grade GPS smoothing
  const kalmanFilterRef = useRef<KalmanFilter>(new KalmanFilter(1, 1));

  // Calculate distance between two coordinates using Haversine formula
  const calculateDistance = useCallback(
    (lat1: number, lon1: number, lat2: number, lon2: number): number => {
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
    },
    []
  );

  const handleSuccess = useCallback(
    (pos: GeolocationPosition) => {
      const rawLat = pos.coords.latitude;
      const rawLng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;

      // Apply Kalman Filter for professional GPS smoothing
      const filtered = kalmanFilterRef.current.process(
        rawLat,
        rawLng,
        accuracy,
        pos.timestamp
      );

      const newPosition: GeolocationData = {
        latitude: filtered.lat,
        longitude: filtered.lng,
        accuracy: pos.coords.accuracy,
        altitude: pos.coords.altitude,
        altitudeAccuracy: pos.coords.altitudeAccuracy,
        heading: pos.coords.heading,
        speed: pos.coords.speed,
        timestamp: pos.timestamp,
      };

      // Apply distance filter
      if (lastPositionRef.current && distanceFilter > 0) {
        const distance = calculateDistance(
          lastPositionRef.current.latitude,
          lastPositionRef.current.longitude,
          newPosition.latitude,
          newPosition.longitude
        );

        if (distance < distanceFilter) {
          return; // Skip update if distance is less than filter
        }
      }

      lastPositionRef.current = newPosition;
      setPosition(newPosition);
      setError(null);
      setIsLoading(false);
    },
    [distanceFilter, calculateDistance]
  );

  const handleError = useCallback((err: GeolocationPositionError) => {
    let errorMessage = 'Erro ao obter localização';

    switch (err.code) {
      case err.PERMISSION_DENIED:
        errorMessage = 'Permissão de localização negada. Por favor, habilite nas configurações.';
        break;
      case err.POSITION_UNAVAILABLE:
        errorMessage = 'Localização indisponível. Verifique o GPS do dispositivo.';
        break;
      case err.TIMEOUT:
        errorMessage = 'Timeout ao buscar localização. Tente novamente.';
        break;
    }

    setError(errorMessage);
    setIsLoading(false);
  }, []);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocalização não suportada pelo navegador');
      setIsLoading(false);
      return;
    }

    setIsTracking(true);
    setIsLoading(true);
    setError(null);

    // Configurações otimizadas para máxima precisão e menor delay
    const geoOptions: PositionOptions = {
      enableHighAccuracy,
      timeout,
      maximumAge,
    };

    // Get initial position immediately
    navigator.geolocation.getCurrentPosition(
      handleSuccess,
      handleError,
      geoOptions
    );

    // Start watching position with high frequency updates
    watchIdRef.current = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      geoOptions
    );
  }, [enableHighAccuracy, timeout, maximumAge, handleSuccess, handleError]);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
    // Reset Kalman Filter
    kalmanFilterRef.current.reset();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return {
    position,
    error,
    isLoading,
    accuracy: position?.accuracy ?? null,
    startTracking,
    stopTracking,
    isTracking,
  };
}
