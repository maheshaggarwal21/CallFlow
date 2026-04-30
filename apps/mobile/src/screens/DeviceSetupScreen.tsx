import React, { useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { api } from "../services/api";
import { useStore } from "../store/useStore";
import { getQueueCount } from "../services/offlineQueue";

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
      <TextInput value={deviceName} onChangeText={setDeviceName} style={styles.input} placeholder="Phone 1" />

      <Text style={styles.label}>Phone Number</Text>
      <TextInput value={phoneNumber} onChangeText={setPhoneNumber} style={styles.input} placeholder="98XXXXXXXX" />

      <Text style={styles.label}>Recording Folder Path</Text>
      <TextInput value={storagePath} onChangeText={setStoragePath} style={styles.input} placeholder="/storage/emulated/0/Recordings" />

      <TouchableOpacity style={styles.button} onPress={onSetup} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? "Saving..." : "Save Device"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e8e2d9",
    padding: 16,
  },
  label: { fontSize: 13, fontWeight: "600", color: "#1a1714", marginTop: 10, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#e8e2d9",
    backgroundColor: "#f0ede6",
    padding: 10,
    borderRadius: 8,
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
    backgroundColor: "rgba(232,118,26,0.1)",
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
  },
  bannerText: { fontSize: 12, color: "#e8761a", fontWeight: "700" },
});
