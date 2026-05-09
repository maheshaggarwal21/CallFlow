import CallLog from "react-native-call-log";
import RNFS from "react-native-fs";
import { api } from "./api";
import { enqueueCall, getQueue, saveQueue } from "./offlineQueue";
import { addUploadLog } from "./uploadLog";
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
  const files = await RNFS.readDir(storagePath);
  const audioFiles = files.filter((f) => {
    if (!f.isFile()) return false;
    const name = f.name.toLowerCase();
    return (
      name.endsWith(".m4a") ||
      name.endsWith(".mp3") ||
      name.endsWith(".wav") ||
      name.endsWith(".aac") ||
      name.endsWith(".amr") ||
      name.endsWith(".3gp")
    );
  });
  if (audioFiles.length === 0) return null;

  const candidates = phoneDigits
    ? audioFiles.filter((f) => f.name.includes(phoneDigits))
    : [];

  const pickClosest = (list: typeof audioFiles) => {
    let best = list[0];
    let bestDiff = Math.abs((best.mtime?.getTime() || 0) - callTimeMs);
    for (const file of list) {
      const diff = Math.abs((file.mtime?.getTime() || 0) - callTimeMs);
      if (diff < bestDiff) {
        best = file;
        bestDiff = diff;
      }
    }
    return { best, bestDiff };
  };

  if (candidates.length > 0) {
    return pickClosest(candidates).best.path;
  }

  const { best, bestDiff } = pickClosest(audioFiles);
  const MAX_TIME_DIFF_MS = 10 * 60 * 1000;
  if (bestDiff > MAX_TIME_DIFF_MS) return null;
  return best.path;
}

function fileNameFromUri(uri?: string) {
  if (!uri) return "no-audio";
  const parts = uri.split(/\\|\//);
  return parts[parts.length - 1] || "no-audio";
}

function ensureFileUri(path?: string) {
  if (!path) return undefined;
  if (path.startsWith("file://") || path.startsWith("content://")) return path;
  return `file://${path}`;
}

function errorMessage(err: unknown) {
  if (!err) return "Upload failed";
  if (typeof err === "string") return err;
  const message = (err as { message?: string })?.message;
  return message || "Upload failed";
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
    const audioPath = await findRecordingFile(storagePath, call.phoneNumber, call.dateTime);
    const audioUri = ensureFileUri(audioPath || undefined);
    const fileName = fileNameFromUri(audioUri || undefined);

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
      await addUploadLog({ fileName, status: "uploaded" });
    } catch (err) {
      const errMsg = errorMessage(err);
      await enqueueCall({ payload, audioUri: audioUri || undefined, fileName, error: errMsg });
      await addUploadLog({ fileName, status: "queued", error: errMsg });
    }
  }

  const queue = await getQueue();
  if (queue.length > 0) {
    const remaining = [] as typeof queue;
    for (const item of queue) {
      const fileName = item.fileName || fileNameFromUri(item.audioUri);
      try {
        await uploadCall(apiKey, item.payload, ensureFileUri(item.audioUri));
        await addUploadLog({ fileName, status: "uploaded" });
      } catch (err) {
        const errMsg = errorMessage(err);
        remaining.push({ ...item, fileName, error: errMsg, queuedAt: item.queuedAt || new Date().toISOString() });
        await addUploadLog({ fileName, status: "failed", error: errMsg });
      }
    }
    await saveQueue(remaining);
  }

  await AsyncStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
}
