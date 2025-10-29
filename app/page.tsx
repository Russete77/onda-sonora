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
      {/* Header - Compact - Hidden during tracking */}
      {!isTracking && (
        <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
          <div className="px-6 py-5">
            <div className="flex items-center justify-between">
              <div className="bg-gradient-to-r from-black/80 via-black/70 to-black/60 backdrop-blur-xl rounded-2xl px-6 py-3 border-2 border-green-500/40 shadow-xl pointer-events-auto">
                <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-green-300 tracking-tight">
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
