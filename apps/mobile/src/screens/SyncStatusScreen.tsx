import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getQueue } from "../services/offlineQueue";
import { syncCallsOnce } from "../services/callSync";
import { getUploadLog, UploadLogEntry } from "../services/uploadLog";

type QueueItem = {
  payload: Record<string, any>;
  audioUri?: string;
  queuedAt?: string;
  fileName?: string;
  error?: string;
};

function formatTimestamp(ts?: string) {
  if (!ts) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleString();
}

export default function SyncStatusScreen() {
  const [logs, setLogs] = useState<UploadLogEntry[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    const [nextLogs, nextQueue] = await Promise.all([
      getUploadLog(),
      getQueue(),
    ]);
    setLogs(nextLogs);
    setQueue(nextQueue as QueueItem[]);
  };

  const onSyncNow = async () => {
    setLoading(true);
    try {
      await syncCallsOnce();
      await loadData();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Sync Status</Text>
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.refreshButton} onPress={loadData} disabled={loading}>
            <Text style={styles.refreshText}>Refresh</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.syncButton} onPress={onSyncNow} disabled={loading}>
            <Text style={styles.syncText}>{loading ? "Syncing..." : "Sync now"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Recent uploads (last 50)</Text>
      {logs.length === 0 && <Text style={styles.empty}>No uploads yet.</Text>}
      {logs.length > 0 && (
        <ScrollView style={styles.list} nestedScrollEnabled>
          {logs.map((item) => (
            <View key={item.id} style={styles.row}>
              <Text style={styles.rowTitle}>{item.fileName}</Text>
              <Text style={styles.rowMeta}>Status: {item.status}</Text>
              <Text style={styles.rowMeta}>Time: {formatTimestamp(item.timestamp)}</Text>
              {item.error ? <Text style={styles.rowError}>Error: {item.error}</Text> : null}
            </View>
          ))}
        </ScrollView>
      )}

      <Text style={[styles.sectionTitle, styles.sectionSpacing]}>Offline queue</Text>
      {queue.length === 0 && <Text style={styles.empty}>Queue is empty.</Text>}
      {queue.length > 0 && (
        <ScrollView style={styles.list} nestedScrollEnabled>
          {queue.map((item, idx) => (
            <View key={`${item.fileName || "queued"}-${idx}`} style={styles.row}>
              <Text style={styles.rowTitle}>{item.fileName || "Unknown file"}</Text>
              <Text style={styles.rowMeta}>Queued: {formatTimestamp(item.queuedAt)}</Text>
              {item.error ? <Text style={styles.rowError}>Error: {item.error}</Text> : null}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    backgroundColor: "#1a1714",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3d3835",
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  actionRow: { flexDirection: "row", gap: 8 },
  title: { fontSize: 16, fontWeight: "700", color: "#f5f2ed" },
  refreshButton: {
    backgroundColor: "#2b2724",
    borderWidth: 1,
    borderColor: "#3d3835",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  refreshText: { color: "#f5f2ed", fontWeight: "700" },
  syncButton: {
    backgroundColor: "#e8761a",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  syncText: { color: "#fff", fontWeight: "700" },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#e8e2d9" },
  sectionSpacing: { marginTop: 14 },
  empty: { marginTop: 6, color: "#7a7470", fontSize: 12 },
  list: { maxHeight: 240, marginTop: 8 },
  row: {
    borderWidth: 1,
    borderColor: "#3d3835",
    backgroundColor: "#2b2724",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  rowTitle: { color: "#f5f2ed", fontWeight: "700", marginBottom: 4 },
  rowMeta: { color: "#c9c2b9", fontSize: 12 },
  rowError: { color: "#e8761a", fontSize: 12, marginTop: 4 },
});
