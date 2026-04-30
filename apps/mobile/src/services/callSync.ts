import CallLog from "react-native-call-log";
import RNFS from "react-native-fs";
import { api } from "./api";
import { enqueueCall, getQueue, saveQueue } from "./offlineQueue";
import { useStore } from "../store/useStore";
import AsyncStorage from "@react-native-async-storage/async-storage";

const LAST_SYNC_KEY = "lastSyncAt";

function mapCallType(type: string, duration: number) {
  if (type === "MISSED") {
    return { direction: "inbound", is_misc: true, misc_reason: "No answer from customer" };
  }
  if (type === "REJECTED") {
    return { direction: "inbound", is_misc: true, misc_reason: "Disconnected immediately" };
  }
  if (duration < 30) {
    return { direction: type === "OUTGOING" ? "outbound" : "inbound", is_misc: true, misc_reason: "Short duration — possible disconnect" };
  }
  return { direction: type === "OUTGOING" ? "outbound" : "inbound", is_misc: false };
}

async function findRecordingFile(storagePath: string, phone: string, callTimeMs: number) {
  const phoneDigits = phone.replace(/\D/g, "");
  if (!phoneDigits) return null;
  const files = await RNFS.readDir(storagePath);
  const matches = files.filter((f) => f.isFile() && f.name.includes(phoneDigits));
  if (matches.length === 0) return null;

  let best = matches[0];
  let bestDiff = Math.abs((best.mtime?.getTime() || 0) - callTimeMs);

  for (const file of matches) {
    const diff = Math.abs((file.mtime?.getTime() || 0) - callTimeMs);
    if (diff < bestDiff) {
      best = file;
      bestDiff = diff;
    }
  }

  return best.path;
}

async function uploadCall(apiKey: string, payload: Record<string, any>, audioUri?: string) {
  const form = new FormData();
  Object.entries(payload).forEach(([key, value]) => {
    form.append(key, String(value));
  });

  if (audioUri) {
    form.append("audio", {
      uri: audioUri,
      type: "audio/wav",
      name: "call.wav",
    } as any);
  }

  await api.post("/mobile/calls", form, {
    headers: {
      "Content-Type": "multipart/form-data",
      "x-api-key": apiKey,
    },
  });
}

export async function syncCallsOnce() {
  const apiKey = useStore.getState().apiKey;
  const deviceId = useStore.getState().deviceId;
  const storagePath = useStore.getState().storagePath;

  if (!apiKey || !deviceId || !storagePath) return;

  const lastSyncRaw = await AsyncStorage.getItem(LAST_SYNC_KEY);
  const lastSync = lastSyncRaw ? Number(lastSyncRaw) : 0;

  const callLogs = await CallLog.loadAll();
  const recent = callLogs.filter((c: any) => (c.dateTime || 0) > lastSync);

  for (const call of recent) {
    const mapped = mapCallType(call.type, Number(call.duration) || 0);
    const audioUri = await findRecordingFile(storagePath, call.phoneNumber, call.dateTime);

    const payload = {
      device_id: deviceId,
      caller_phone: call.phoneNumber || "Unknown",
      call_direction: mapped.direction,
      called_at: new Date(call.dateTime).toISOString(),
      duration_secs: Number(call.duration) || 0,
      is_misc: mapped.is_misc,
      misc_reason: mapped.misc_reason || "",
    };

    try {
      await uploadCall(apiKey, payload, audioUri || undefined);
    } catch {
      await enqueueCall({ payload, audioUri: audioUri || undefined });
    }
  }

  const queue = await getQueue();
  if (queue.length > 0) {
    const remaining = [] as typeof queue;
    for (const item of queue) {
      try {
        await uploadCall(apiKey, item.payload, item.audioUri);
      } catch {
        remaining.push(item);
      }
    }
    await saveQueue(remaining);
  }

  await AsyncStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
}
