import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import DocumentPicker from "react-native-document-picker";
import { api } from "../services/api";
import { useStore } from "../store/useStore";
import { getQueueCount } from "../services/offlineQueue";
import { safUriToPath } from "../services/safUriToPath";

export default function DeviceSetupScreen() {
  const [deviceName, setDeviceName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [storagePath, setStoragePath] = useState("");
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

  const onPickFolder = async () => {
    try {
      const result = await DocumentPicker.pickDirectory();
      if (!result?.uri) return;

      const realPath = safUriToPath(result.uri);
      if (!realPath) {
        Alert.alert(
          "Invalid Folder",
          "Could not resolve this folder path. Please select a folder from device storage, not a cloud location."
        );
        return;
      }
      setStoragePath(realPath);
    } catch (err) {
      if (!DocumentPicker.isCancel(err)) {
        Alert.alert("Picker Error", "Failed to open folder picker.");
      }
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
      <TouchableOpacity style={styles.folderPickerButton} onPress={onPickFolder}>
        <Text
          style={[
            styles.folderPickerButtonText,
            !storagePath && styles.folderPickerPlaceholder,
          ]}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {storagePath ? storagePath : "Tap to select folder…"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={onSetup} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? "Saving..." : "Save Device"}</Text>
      </TouchableOpacity>
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
  folderPickerButton: {
    borderWidth: 1,
    borderColor: "#3d3835",
    backgroundColor: "#2b2724",
    padding: 10,
    borderRadius: 8,
  },
  folderPickerButtonText: {
    color: "#f5f2ed",
    fontSize: 14,
  },
  folderPickerPlaceholder: {
    color: "#6b6460",
  },
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
