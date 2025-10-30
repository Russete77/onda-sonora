/**
 * IndexedDB para persistência de corridas
 * Salva histórico completo de corridas offline
 */

export interface RunData {
  id?: number; // Auto-increment
  timestamp: number; // Unix timestamp
  date: string; // Human readable date
  duration: number; // segundos
  distance: number; // metros
  coordinates: [number, number][]; // [lng, lat]
  elevationGain: number; // metros
  elevationLoss: number; // metros
  averagePace: number; // min/km
  averageSpeed: number; // km/h
  maxSpeed: number; // km/h
  splits: Split[]; // Splits por KM
  routeMatched: boolean; // Se usou Map Matching
  weather?: {
    temperature?: number;
    condition?: string;
  };
  notes?: string; // Notas do usuário
}

export interface Split {
  km: number; // Número do KM (1, 2, 3...)
  time: number; // Tempo em segundos
  pace: string; // min/km formatado (ex: "5:30")
  distance: number; // Distância exata (pode ser < 1000m no último)
}

const DB_NAME = 'ondasonora_runs';
const DB_VERSION = 1;
const STORE_NAME = 'runs';

/**
 * Abre conexão com IndexedDB
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Criar object store se não existir
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        });

        // Criar índices para busca
        objectStore.createIndex('timestamp', 'timestamp', { unique: false });
        objectStore.createIndex('date', 'date', { unique: false });
        objectStore.createIndex('distance', 'distance', { unique: false });
      }
    };
  });
}

/**
 * Salva uma corrida no banco
 */
export async function saveRun(run: Omit<RunData, 'id'>): Promise<number> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(run);

    request.onsuccess = () => resolve(request.result as number);
    request.onerror = () => reject(request.error);

    transaction.oncomplete = () => db.close();
  });
}

/**
 * Lista todas as corridas (ordenadas por data, mais recente primeiro)
 */
export async function getAllRuns(): Promise<RunData[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const runs = request.result as RunData[];
      // Ordenar por timestamp (mais recente primeiro)
      runs.sort((a, b) => b.timestamp - a.timestamp);
      resolve(runs);
    };
    request.onerror = () => reject(request.error);

    transaction.oncomplete = () => db.close();
  });
}

/**
 * Busca uma corrida específica por ID
 */
export async function getRun(id: number): Promise<RunData | undefined> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);

    transaction.oncomplete = () => db.close();
  });
}

/**
 * Deleta uma corrida
 */
export async function deleteRun(id: number): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);

    transaction.oncomplete = () => db.close();
  });
}

/**
 * Atualiza uma corrida existente
 */
export async function updateRun(run: RunData): Promise<void> {
  if (!run.id) {
    throw new Error('Run must have an ID to be updated');
  }

  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(run);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);

    transaction.oncomplete = () => db.close();
  });
}

/**
 * Estatísticas totais (todas as corridas)
 */
export async function getTotalStats(): Promise<{
  totalRuns: number;
  totalDistance: number; // metros
  totalTime: number; // segundos
  totalElevationGain: number; // metros
  averagePace: number; // min/km
  longestRun: number; // metros
}> {
  const runs = await getAllRuns();

  if (runs.length === 0) {
    return {
      totalRuns: 0,
      totalDistance: 0,
      totalTime: 0,
      totalElevationGain: 0,
      averagePace: 0,
      longestRun: 0,
    };
  }

  const totalDistance = runs.reduce((sum, run) => sum + run.distance, 0);
  const totalTime = runs.reduce((sum, run) => sum + run.duration, 0);
  const totalElevationGain = runs.reduce((sum, run) => sum + run.elevationGain, 0);
  const longestRun = Math.max(...runs.map((run) => run.distance));

  // Average pace (min/km)
  const averagePace = totalDistance > 0 ? (totalTime / 60) / (totalDistance / 1000) : 0;

  return {
    totalRuns: runs.length,
    totalDistance,
    totalTime,
    totalElevationGain,
    averagePace,
    longestRun,
  };
}

/**
 * Export runs como JSON (backup)
 */
export async function exportRunsAsJSON(): Promise<string> {
  const runs = await getAllRuns();
  return JSON.stringify(runs, null, 2);
}

/**
 * Import runs de JSON (restore backup)
 */
export async function importRunsFromJSON(jsonString: string): Promise<number> {
  const runs = JSON.parse(jsonString) as RunData[];
  let imported = 0;

  for (const run of runs) {
    try {
      // Remove ID para evitar conflitos
      const { id, ...runData } = run;
      await saveRun(runData);
      imported++;
    } catch (error) {
      console.error('Failed to import run:', error);
    }
  }

  return imported;
}
