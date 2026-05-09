import AsyncStorage from "@react-native-async-storage/async-storage";

const LOG_KEY = "uploadLog";
const MAX_ENTRIES = 50;

export type UploadLogEntry = {
  id: string;
  fileName: string;
  status: "uploaded" | "queued" | "failed";
  error?: string;
  timestamp: string;
};

export async function getUploadLog(): Promise<UploadLogEntry[]> {
  const raw = await AsyncStorage.getItem(LOG_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as UploadLogEntry[];
  } catch {
    return [];
  }
}

export async function addUploadLog(entry: {
  fileName: string;
  status: "uploaded" | "queued" | "failed";
  error?: string;
  timestamp?: string;
}) {
  const current = await getUploadLog();
  const item: UploadLogEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    fileName: entry.fileName,
    status: entry.status,
    error: entry.error,
    timestamp: entry.timestamp || new Date().toISOString(),
  };
  const next = [item, ...current].slice(0, MAX_ENTRIES);
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify(next));
  return item;
}
