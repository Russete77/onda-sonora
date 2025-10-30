/**
 * Hook de Feedback de Áudio usando Web Speech API
 * Avisos por voz durante a corrida - 100% GRÁTIS
 */

import { useEffect, useRef, useState } from 'react';

export interface AudioFeedbackConfig {
  enabled: boolean;
  language: 'pt-BR' | 'en-US' | 'es-ES';
  intervalKm: number; // Intervalo de avisos (1 = a cada 1km, 0.5 = a cada 500m)
  announceDistance: boolean;
  announcePace: boolean;
  announceTime: boolean;
  announcePause: boolean;
  volume: number; // 0-1
  rate: number; // 0.5-2 (velocidade da fala)
}

interface AudioMessage {
  text: string;
  priority: 'high' | 'normal' | 'low';
}

const DEFAULT_CONFIG: AudioFeedbackConfig = {
  enabled: true,
  language: 'pt-BR',
  intervalKm: 1, // A cada 1km
  announceDistance: true,
  announcePace: true,
  announceTime: true,
  announcePause: true,
  volume: 1,
  rate: 1,
};

export function useAudioFeedback(config: Partial<AudioFeedbackConfig> = {}) {
  const fullConfig: AudioFeedbackConfig = { ...DEFAULT_CONFIG, ...config };

  const [isSupported, setIsSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const messageQueueRef = useRef<AudioMessage[]>([]);
  const lastDistanceAnnouncedRef = useRef<number>(0);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  // Check Web Speech API support
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setIsSupported(true);
      synthRef.current = window.speechSynthesis;
    } else {
      console.warn('Web Speech API não suportada neste navegador');
    }
  }, []);

  // Process message queue
  const processQueue = () => {
    if (!fullConfig.enabled || !isSupported || !synthRef.current) return;
    if (isSpeaking || messageQueueRef.current.length === 0) return;

    const message = messageQueueRef.current.shift();
    if (!message) return;

    setIsSpeaking(true);

    const utterance = new SpeechSynthesisUtterance(message.text);
    utterance.lang = fullConfig.language;
    utterance.volume = fullConfig.volume;
    utterance.rate = fullConfig.rate;

    utterance.onend = () => {
      setIsSpeaking(false);
      // Process next message after 500ms
      setTimeout(processQueue, 500);
    };

    utterance.onerror = (event) => {
      console.error('Speech synthesis error:', event);
      setIsSpeaking(false);
      setTimeout(processQueue, 500);
    };

    synthRef.current.speak(utterance);
  };

  // Add message to queue
  const speak = (text: string, priority: 'high' | 'normal' | 'low' = 'normal') => {
    if (!fullConfig.enabled || !isSupported) return;

    const message: AudioMessage = { text, priority };

    // High priority: add to front
    if (priority === 'high') {
      messageQueueRef.current.unshift(message);
    } else {
      messageQueueRef.current.push(message);
    }

    processQueue();
  };

  // Format pace for speech
  const formatPaceForSpeech = (paceMinPerKm: number): string => {
    const minutes = Math.floor(paceMinPerKm);
    const seconds = Math.floor((paceMinPerKm - minutes) * 60);

    if (fullConfig.language === 'pt-BR') {
      return `${minutes} minutos e ${seconds} segundos por quilômetro`;
    } else if (fullConfig.language === 'en-US') {
      return `${minutes} minutes and ${seconds} seconds per kilometer`;
    } else {
      return `${minutes} minutos y ${seconds} segundos por kilómetro`;
    }
  };

  // Format time for speech
  const formatTimeForSpeech = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (fullConfig.language === 'pt-BR') {
      if (hours > 0) {
        return `${hours} hora${hours > 1 ? 's' : ''} e ${minutes} minuto${minutes !== 1 ? 's' : ''}`;
      }
      return `${minutes} minuto${minutes !== 1 ? 's' : ''} e ${secs} segundo${secs !== 1 ? 's' : ''}`;
    } else if (fullConfig.language === 'en-US') {
      if (hours > 0) {
        return `${hours} hour${hours > 1 ? 's' : ''} and ${minutes} minute${minutes !== 1 ? 's' : ''}`;
      }
      return `${minutes} minute${minutes !== 1 ? 's' : ''} and ${secs} second${secs !== 1 ? 's' : ''}`;
    } else {
      if (hours > 0) {
        return `${hours} hora${hours > 1 ? 's' : ''} y ${minutes} minuto${minutes !== 1 ? 's' : ''}`;
      }
      return `${minutes} minuto${minutes !== 1 ? 's' : ''} y ${secs} segundo${secs !== 1 ? 's' : ''}`;
    }
  };

  // Announce distance milestone
  const announceDistance = (distanceKm: number, paceMinPerKm?: number, elapsedSeconds?: number) => {
    const kmMilestone = Math.floor(distanceKm / fullConfig.intervalKm) * fullConfig.intervalKm;

    // Only announce when crossing a milestone
    if (kmMilestone > lastDistanceAnnouncedRef.current && kmMilestone > 0) {
      lastDistanceAnnouncedRef.current = kmMilestone;

      let message = '';

      if (fullConfig.language === 'pt-BR') {
        message = `Você completou ${kmMilestone} quilômetro${kmMilestone > 1 ? 's' : ''}`;

        if (fullConfig.announcePace && paceMinPerKm && paceMinPerKm < 10) {
          message += `. Pace: ${formatPaceForSpeech(paceMinPerKm)}`;
        }

        if (fullConfig.announceTime && elapsedSeconds) {
          message += `. Tempo: ${formatTimeForSpeech(elapsedSeconds)}`;
        }
      } else if (fullConfig.language === 'en-US') {
        message = `You completed ${kmMilestone} kilometer${kmMilestone > 1 ? 's' : ''}`;

        if (fullConfig.announcePace && paceMinPerKm && paceMinPerKm < 10) {
          message += `. Pace: ${formatPaceForSpeech(paceMinPerKm)}`;
        }

        if (fullConfig.announceTime && elapsedSeconds) {
          message += `. Time: ${formatTimeForSpeech(elapsedSeconds)}`;
        }
      }

      speak(message, 'high');
    }
  };

  // Announce pause/resume
  const announcePause = () => {
    if (!fullConfig.announcePause) return;

    if (fullConfig.language === 'pt-BR') {
      speak('Corrida pausada', 'high');
    } else if (fullConfig.language === 'en-US') {
      speak('Run paused', 'high');
    } else {
      speak('Carrera pausada', 'high');
    }
  };

  const announceResume = () => {
    if (!fullConfig.announcePause) return;

    if (fullConfig.language === 'pt-BR') {
      speak('Retomando corrida', 'high');
    } else if (fullConfig.language === 'en-US') {
      speak('Resuming run', 'high');
    } else {
      speak('Reanudando carrera', 'high');
    }
  };

  // Announce start
  const announceStart = () => {
    if (fullConfig.language === 'pt-BR') {
      speak('Corrida iniciada. Boa sorte!', 'high');
    } else if (fullConfig.language === 'en-US') {
      speak('Run started. Good luck!', 'high');
    } else {
      speak('Carrera iniciada. Buena suerte!', 'high');
    }
  };

  // Announce stop
  const announceStop = (distanceKm: number, elapsedSeconds: number) => {
    let message = '';

    if (fullConfig.language === 'pt-BR') {
      message = `Corrida finalizada. Você correu ${distanceKm.toFixed(2)} quilômetros em ${formatTimeForSpeech(elapsedSeconds)}`;
    } else if (fullConfig.language === 'en-US') {
      message = `Run completed. You ran ${distanceKm.toFixed(2)} kilometers in ${formatTimeForSpeech(elapsedSeconds)}`;
    } else {
      message = `Carrera completada. Corriste ${distanceKm.toFixed(2)} kilómetros en ${formatTimeForSpeech(elapsedSeconds)}`;
    }

    speak(message, 'high');
  };

  // Clear all queued messages
  const clearQueue = () => {
    messageQueueRef.current = [];
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setIsSpeaking(false);
  };

  // Reset distance tracking
  const resetTracking = () => {
    lastDistanceAnnouncedRef.current = 0;
  };

  return {
    isSupported,
    isSpeaking,
    speak,
    announceDistance,
    announcePause,
    announceResume,
    announceStart,
    announceStop,
    clearQueue,
    resetTracking,
  };
}
