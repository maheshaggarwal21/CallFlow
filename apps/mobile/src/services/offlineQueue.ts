import AsyncStorage from "@react-native-async-storage/async-storage";

type QueuedCall = {
  payload: Record<string, any>;
  audioUri?: string;
};

const QUEUE_KEY = "offlineQueue";

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

export async function enqueueCall(item: QueuedCall) {
  const queue = await getQueue();
  queue.push(item);
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
