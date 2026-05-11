import CallLog from "react-native-call-log";
import RNFS from "react-native-fs";
import { api } from "./api";
import { enqueueCall, getQueue, saveQueue } from "./offlineQueue";
import { addUploadLog } from "./uploadLog";
import { useStore } from "../store/useStore";
import AsyncStorage from "@react-native-async-storage/async-storage";

const LAST_SYNC_KEY = "lastSyncAt";
const MAX_QUEUE_RETRIES = 5;

// Guard: prevents two sync runs from overlapping (user taps "Sync now" while auto-sync is running)
let isSyncing = false;

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

// MIME type from file extension — server needs the correct type for AI pipeline
const AUDIO_MIME: Record<string, string> = {
  m4a: "audio/mp4",
  aac: "audio/aac",
  amr: "audio/amr",
  "3gp": "audio/3gpp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

function getAudioMime(uri: string): { mime: string; name: string } {
  const ext = uri.split(".").pop()?.toLowerCase() ?? "wav";
  return {
    mime: AUDIO_MIME[ext] ?? "audio/octet-stream",
    name: `call.${ext}`,
  };
}

// Recursively scan for audio files up to 2 levels deep.
// Many recording apps (ACR, Cube ACR, MIUI) store files in date-based subdirs.
async function listAudioFiles(dirPath: string, depth = 0): Promise<RNFS.ReadDirItem[]> {
  if (depth > 2) return [];
  try {
    const items = await RNFS.readDir(dirPath);
    const results: RNFS.ReadDirItem[] = [];
    for (const item of items) {
      if (item.isFile()) {
        const name = item.name.toLowerCase();
        if (
          name.endsWith(".m4a") || name.endsWith(".mp3") || name.endsWith(".wav") ||
          name.endsWith(".aac") || name.endsWith(".amr") || name.endsWith(".3gp") ||
          name.endsWith(".ogg")
        ) {
          results.push(item);
        }
      } else if (item.isDirectory()) {
        const sub = await listAudioFiles(item.path, depth + 1);
        results.push(...sub);
      }
    }
    return results;
  } catch {
    return [];
  }
}

async function findRecordingFile(storagePath: string, phone: string, callTimeMs: number) {
  const phoneDigits = phone.replace(/\D/g, "");
  const audioFiles = await listAudioFiles(storagePath);
  if (audioFiles.length === 0) return null;

  // Prefer files whose name contains the caller's phone digits
  const candidates = phoneDigits
    ? audioFiles.filter((f) => f.name.includes(phoneDigits))
    : [];

  const pickClosest = (list: RNFS.ReadDirItem[]) => {
    let best = list[0];
    let bestDiff = Math.abs((best.mtime?.getTime() ?? 0) - callTimeMs);
    for (const file of list) {
      const diff = Math.abs((file.mtime?.getTime() ?? 0) - callTimeMs);
      if (diff < bestDiff) { best = file; bestDiff = diff; }
    }
    return { best, bestDiff };
  };

  if (candidates.length > 0) {
    return pickClosest(candidates).best.path;
  }

  // Fall back to closest-by-mtime within 10 minutes
  const { best, bestDiff } = pickClosest(audioFiles);
  if (bestDiff > 10 * 60 * 1000) return null;
  return best.path;
}

function fileNameFromUri(uri?: string) {
  if (!uri) return "no-audio";
  const parts = uri.split(/\\|\//);
  return parts[parts.length - 1] || "no-audio";
}

function ensureFileUri(filePath?: string) {
  if (!filePath) return undefined;
  if (filePath.startsWith("file://") || filePath.startsWith("content://")) return filePath;
  return `file://${filePath}`;
}

function errorMessage(err: unknown) {
  if (!err) return "Upload failed";
  if (typeof err === "string") return err;
  return (err as { message?: string })?.message || "Upload failed";
}

async function uploadCall(apiKey: string, payload: Record<string, any>, audioUri?: string) {
  const form = new FormData();
  Object.entries(payload).forEach(([key, value]) => form.append(key, String(value)));

  if (audioUri) {
    const { mime, name } = getAudioMime(audioUri);
    form.append("audio", { uri: audioUri, type: mime, name } as any);
  }

  await api.post("/mobile/calls", form, {
    headers: {
      "Content-Type": "multipart/form-data",
      "x-api-key": apiKey,
    },
  });
}

export async function syncCallsOnce() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const { apiKey, deviceId, storagePath } = useStore.getState();
    if (!apiKey || !deviceId || !storagePath) return;

    const lastSyncRaw = await AsyncStorage.getItem(LAST_SYNC_KEY);
    const lastSync = lastSyncRaw ? Number(lastSyncRaw) : 0;

    // Load only calls since last sync — avoids loading entire call history into memory
    const callLogs = await (CallLog as any).load(500, { minTimestamp: lastSync });
    const recent: any[] = Array.isArray(callLogs)
      ? callLogs.filter((c: any) => (c.dateTime || 0) > lastSync)
      : [];

    for (const call of recent) {
      const mapped = mapCallType(call.type, Number(call.duration) || 0);
      const audioPath = await findRecordingFile(storagePath, call.phoneNumber, call.dateTime);
      const audioUri = ensureFileUri(audioPath ?? undefined);
      const fileName = fileNameFromUri(audioUri ?? undefined);

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
        await uploadCall(apiKey, payload, audioUri ?? undefined);
        await addUploadLog({ fileName, status: "uploaded" });
      } catch (err) {
        const errMsg = errorMessage(err);
        await enqueueCall({ payload, audioUri: audioUri ?? undefined, fileName, error: errMsg });
        await addUploadLog({ fileName, status: "queued", error: errMsg });
      }
    }

    // Retry offline queue
    const queue = await getQueue();
    if (queue.length > 0) {
      const remaining: typeof queue = [];
      for (const item of queue) {
        const fileName = item.fileName || fileNameFromUri(item.audioUri);
        try {
          await uploadCall(apiKey, item.payload, ensureFileUri(item.audioUri));
          await addUploadLog({ fileName, status: "uploaded" });
        } catch (err) {
          const errMsg = errorMessage(err);
          const retryCount = (item.retryCount ?? 0) + 1;
          if (retryCount < MAX_QUEUE_RETRIES) {
            remaining.push({ ...item, fileName, error: errMsg, retryCount, queuedAt: item.queuedAt || new Date().toISOString() });
          }
          await addUploadLog({ fileName, status: "failed", error: errMsg });
        }
      }
      await saveQueue(remaining);
    }

    await AsyncStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  } catch (err) {
    console.error("[sync] syncCallsOnce failed:", err);
    await addUploadLog({ fileName: "sync-error", status: "failed", error: errorMessage(err) }).catch(() => undefined);
  } finally {
    isSyncing = false;
  }
}
