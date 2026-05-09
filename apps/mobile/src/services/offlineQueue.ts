import AsyncStorage from "@react-native-async-storage/async-storage";

type QueuedCall = {
  payload: Record<string, any>;
  audioUri?: string;
  queuedAt?: string;
  fileName?: string;
  error?: string;
};

const QUEUE_KEY = "offlineQueue";
const MAX_QUEUE_SIZE = 500;

export async function getQueue(): Promise<QueuedCall[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedCall[];
  } catch {
    return [];
  }
}

export async function saveQueue(queue: QueuedCall[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function fileNameFromUri(uri?: string) {
  if (!uri) return "no-audio";
  const parts = uri.split(/\\|\//);
  return parts[parts.length - 1] || "no-audio";
}

export async function enqueueCall(item: QueuedCall) {
  const queue = await getQueue();
  const next: QueuedCall = {
    ...item,
    queuedAt: item.queuedAt || new Date().toISOString(),
    fileName: item.fileName || fileNameFromUri(item.audioUri),
  };
  queue.push(next);
  if (queue.length > MAX_QUEUE_SIZE) {
    queue.splice(0, queue.length - MAX_QUEUE_SIZE);
  }
  await saveQueue(queue);
}

export async function dequeueCall(): Promise<QueuedCall | null> {
  const queue = await getQueue();
  const item = queue.shift() || null;
  await saveQueue(queue);
  return item;
}

export async function getQueueCount(): Promise<number> {
  const queue = await getQueue();
  return queue.length;
}
