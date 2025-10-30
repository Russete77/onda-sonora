/**
 * Activity Recognition Hook
 * Detecta estado do corredor: parado, andando, correndo
 * Usado para pausa automática inteligente
 */

import { useState, useEffect, useRef } from 'react';

export type ActivityState = 'stationary' | 'walking' | 'running';

interface UseActivityRecognitionOptions {
  speedThreshold?: {
    stationary: number; // m/s
    walking: number; // m/s
    running: number; // m/s
  };
  minDuration?: number; // ms - tempo mínimo no estado antes de confirmar
}

export function useActivityRecognition(
  speed: number | null,
  options: UseActivityRecognitionOptions = {}
) {
  const {
    speedThreshold = {
      stationary: 0.5, // < 1.8 km/h
      walking: 2.0, // < 7.2 km/h
      running: 2.0, // >= 7.2 km/h
    },
    minDuration = 3000, // 3 segundos
  } = options;

  const [activityState, setActivityState] = useState<ActivityState>('stationary');
  const [isPaused, setIsPaused] = useState(false);

  const stateStartTimeRef = useRef<number>(Date.now());
  const lastStateRef = useRef<ActivityState>('stationary');

  useEffect(() => {
    if (speed === null) return;

    // Determine current activity
    let currentActivity: ActivityState = 'stationary';

    if (speed >= speedThreshold.running) {
      currentActivity = 'running';
    } else if (speed >= speedThreshold.walking) {
      currentActivity = 'walking';
    } else {
      currentActivity = 'stationary';
    }

    // Check if state changed
    if (currentActivity !== lastStateRef.current) {
      // State changed - reset timer
      stateStartTimeRef.current = Date.now();
      lastStateRef.current = currentActivity;
    } else {
      // Same state - check if enough time passed
      const timeInState = Date.now() - stateStartTimeRef.current;

      if (timeInState >= minDuration) {
        // Confirmed state change
        setActivityState(currentActivity);

        // Auto-pause when stationary for extended period
        if (currentActivity === 'stationary') {
          setIsPaused(true);
        } else if (currentActivity === 'running' || currentActivity === 'walking') {
          setIsPaused(false);
        }
      }
    }
  }, [speed, speedThreshold, minDuration]);

  return {
    activityState,
    isPaused,
    isMoving: activityState !== 'stationary',
  };
}
