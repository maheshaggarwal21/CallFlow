import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import RNFS from "react-native-fs";
import { api } from "../services/api";
import { useStore } from "../store/useStore";
import { getQueueCount } from "../services/offlineQueue";

const ROOT = RNFS.ExternalStorageDirectoryPath; // /storage/emulated/0
const AUDIO_EXTS = [".mp4", ".m4a", ".amr", ".3gp", ".aac", ".mp3", ".wav", ".ogg"];

function audioCount(items: RNFS.ReadDirItem[]) {
  return items.filter((f) => f.isFile() && AUDIO_EXTS.some((e) => f.name.toLowerCase().endsWith(e))).length;
}

type DirEntry = { name: string; path: string; isDir: boolean; recCount: number };

function FolderBrowser({
  visible,
  onSelect,
  onClose,
}: {
  visible: boolean;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [currentPath, setCurrentPath] = useState(ROOT);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) loadDir(ROOT);
  }, [visible]);

  const loadDir = async (path: string) => {
    setLoading(true);
    setCurrentPath(path);
    try {
      const items = await RNFS.readDir(path);
      const dirs = items.filter((i) => i.isDirectory());
      // For each subdirectory, check audio count (best-effort, ignore errors)
      const mapped: DirEntry[] = await Promise.all(
        dirs.map(async (d) => {
          let recCount = 0;
          try {
            const sub = await RNFS.readDir(d.path);
            recCount = audioCount(sub);
          } catch {}
          return { name: d.name, path: d.path, isDir: true, recCount };
        })
      );
      // Sort: folders with recordings first, then alphabetically
      mapped.sort((a, b) => {
        if (b.recCount !== a.recCount) return b.recCount - a.recCount;
        return a.name.localeCompare(b.name);
      });
      setEntries(mapped);
    } catch {
      Alert.alert("Cannot open folder", "This folder is not accessible.");
    } finally {
      setLoading(false);
    }
  };

  const goUp = () => {
    if (currentPath === ROOT) return;
    const parent = currentPath.substring(0, currentPath.lastIndexOf("/"));
    loadDir(parent || ROOT);
  };

  // Build breadcrumb relative to ROOT
  const crumb = currentPath.startsWith(ROOT)
    ? "Storage" + currentPath.slice(ROOT.length)
    : currentPath;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={bs.root}>
        {/* Header */}
        <View style={bs.header}>
          <TouchableOpacity onPress={onClose} style={bs.closeBtn}>
            <Text style={bs.closeTxt}>✕</Text>
          </TouchableOpacity>
          <Text style={bs.title} numberOfLines={1} ellipsizeMode="middle">
            {crumb}
          </Text>
        </View>

        {/* Up button */}
        {currentPath !== ROOT && (
          <TouchableOpacity style={bs.upRow} onPress={goUp}>
            <Text style={bs.upTxt}>⬆  Go up</Text>
          </TouchableOpacity>
        )}

        {/* Use this folder */}
        <TouchableOpacity style={bs.useBtn} onPress={() => onSelect(currentPath)}>
          <Text style={bs.useTxt}>✔  Use this folder</Text>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator color="#e8761a" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(item) => item.path}
            renderItem={({ item }) => (
              <TouchableOpacity style={bs.row} onPress={() => loadDir(item.path)}>
                <View style={bs.rowLeft}>
                  <Text style={bs.folderIcon}>📁</Text>
                  <Text style={bs.folderName} numberOfLines={1}>
                    {item.name}
                  </Text>
                </View>
                {item.recCount > 0 && (
                  <View style={bs.badge}>
                    <Text style={bs.badgeTxt}>{item.recCount} rec</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={bs.empty}>No subfolders here.</Text>
            }
          />
        )}
      </View>
    </Modal>
  );
}

export default function DeviceSetupScreen() {
  const [deviceName, setDeviceName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [storagePath, setStoragePath] = useState("");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const apiKey = useStore((s) => s.apiKey);
  const setDevice = useStore((s) => s.setDevice);

  useEffect(() => {
    refreshPending();
  }, []);

  const refreshPending = async () => {
    const count = await getQueueCount();
    setPendingCount(count);
  };

  const onFolderSelected = async (path: string) => {
    setBrowserOpen(false);
    // Verify folder is readable
    try {
      const items = await RNFS.readDir(path);
      const count = audioCount(items);
      if (count === 0) {
        Alert.alert(
          "No recordings found",
          `The folder:\n${path}\n\nis accessible but contains no recording files. Make sure you're selecting the right folder. You can still use it if recordings will appear here later.`,
          [
            { text: "Use anyway", onPress: () => setStoragePath(path) },
            { text: "Pick again", onPress: () => setBrowserOpen(true) },
          ]
        );
      } else {
        setStoragePath(path);
        Alert.alert("Folder selected", `Found ${count} recording(s).\nReady to save.`);
      }
    } catch {
      Alert.alert("Not accessible", "Could not read this folder. Try granting All Files Access in system settings.");
    }
  };

  const onSetup = async () => {
    if (!apiKey) return;
    if (!deviceName || !phoneNumber || !storagePath) {
      Alert.alert("Missing fields", "All fields are required.");
      return;
    }

    try {
      setLoading(true);
      const res = await api.post(
        "/mobile/device/setup",
        { device_name: deviceName, phone_number: phoneNumber, storage_path: storagePath },
        { headers: { "x-api-key": apiKey } }
      );
      setDevice(res.data.device_id, storagePath);
      await refreshPending();
    } catch {
      Alert.alert("Setup failed", "Unable to register device.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.card}>
      {pendingCount > 0 && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{pendingCount} calls pending upload</Text>
        </View>
      )}

      <Text style={styles.label}>Device Name</Text>
      <TextInput
        value={deviceName}
        onChangeText={setDeviceName}
        style={styles.input}
        placeholder="Phone 1"
        placeholderTextColor="#6b6460"
      />

      <Text style={styles.label}>Phone Number</Text>
      <TextInput
        value={phoneNumber}
        onChangeText={setPhoneNumber}
        style={styles.input}
        placeholder="98XXXXXXXX"
        placeholderTextColor="#6b6460"
        keyboardType="phone-pad"
      />

      <Text style={styles.label}>Recording Folder</Text>
      <TouchableOpacity style={styles.pickerButton} onPress={() => setBrowserOpen(true)}>
        <Text
          style={[styles.pickerText, !storagePath && styles.pickerPlaceholder]}
          numberOfLines={2}
          ellipsizeMode="middle"
        >
          {storagePath || "Tap to browse and select folder…"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={onSetup} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? "Saving..." : "Save Device"}</Text>
      </TouchableOpacity>

      <FolderBrowser
        visible={browserOpen}
        onSelect={onFolderSelected}
        onClose={() => setBrowserOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1a1714",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3d3835",
    padding: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#e8e2d9",
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#3d3835",
    backgroundColor: "#2b2724",
    padding: 10,
    borderRadius: 8,
    color: "#f5f2ed",
  },
  pickerButton: {
    borderWidth: 1,
    borderColor: "#e8761a",
    backgroundColor: "#2b2724",
    padding: 12,
    borderRadius: 8,
  },
  pickerText: { color: "#f5f2ed", fontSize: 13 },
  pickerPlaceholder: { color: "#6b6460" },
  button: {
    marginTop: 16,
    backgroundColor: "#e8761a",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
  banner: {
    backgroundColor: "rgba(232,118,26,0.15)",
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
  },
  bannerText: { fontSize: 12, color: "#e8761a", fontWeight: "700" },
});

const bs = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1a1714" },
  header: {
    paddingTop: 44,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: "#252220",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#3d3835",
    alignItems: "center",
    justifyContent: "center",
  },
  closeTxt: { color: "#f5f2ed", fontSize: 14, fontWeight: "700" },
  title: { flex: 1, color: "#f5f2ed", fontSize: 13, fontWeight: "600" },
  upRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: "#2b2724",
  },
  upTxt: { color: "#a09890", fontSize: 14 },
  useBtn: {
    margin: 12,
    backgroundColor: "#e8761a",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  useTxt: { color: "#fff", fontWeight: "700", fontSize: 15 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: "#252220",
  },
  rowLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  folderIcon: { fontSize: 18, marginRight: 12 },
  folderName: { color: "#e8e2d9", fontSize: 14, flex: 1 },
  badge: {
    backgroundColor: "rgba(232,118,26,0.2)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 8,
  },
  badgeTxt: { color: "#e8761a", fontSize: 11, fontWeight: "700" },
  empty: { color: "#7a7470", textAlign: "center", marginTop: 40, fontSize: 13 },
});
