'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

const MapboxTracker = dynamic(() => import('@/components/MapboxTracker'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-black">
      <div className="text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-green-500 mx-auto mb-4"></div>
        <p className="text-white text-lg">Carregando mapa...</p>
      </div>
    </div>
  ),
});

export default function Home() {
  const [isTracking, setIsTracking] = useState(false);

  return (
    <main className="h-screen w-screen overflow-hidden bg-black">
      {/* Header - Centered Logo - Hidden during tracking */}
      {!isTracking && (
        <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
          <div className="px-6 py-6">
            <div className="flex items-center justify-center">
              <div className="bg-black/60 backdrop-blur-md rounded-2xl px-6 py-3 border border-white/10 pointer-events-auto">
                <h1 className="text-xl font-bold text-white/90 tracking-wide">
                  ONDA SONORA
                </h1>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Map */}
      <div className="absolute inset-0 w-full h-full">
        <MapboxTracker onTrackingChange={setIsTracking} />
      </div>
    </main>
  );
}
