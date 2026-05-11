import React, { useState } from "react";
import {
  Alert,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Camera } from "react-native-camera-kit";
import { api } from "../services/api";
import { useStore } from "../store/useStore";

export default function LoginScreen() {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const setAuth = useStore((s) => s.setAuth);

  const onQrScan = () => {
    setScannerOpen(true);
  };

  const parseApiKey = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    const lower = trimmed.toLowerCase();
    const keyParam = lower.includes("api_key=") ? "api_key=" : lower.includes("apikey=") ? "apikey=" : "";
    if (!keyParam) return trimmed;
    const idx = lower.indexOf(keyParam);
    if (idx < 0) return trimmed;
    const value = trimmed.slice(idx + keyParam.length).split(/[&#?]/)[0];
    return value.trim();
  };

  const onReadCode = (event: { nativeEvent: { codeStringValue?: string } }) => {
    const raw = event?.nativeEvent?.codeStringValue || "";
    const parsed = parseApiKey(raw);
    if (!parsed) {
      Alert.alert("Invalid QR", "No API key found in this code.");
      return;
    }
    setApiKey(parsed);
    setScannerOpen(false);
  };

  const onLogin = async () => {
    if (!apiKey.trim()) {
      Alert.alert("API Key required", "Enter the API key provided by the owner.");
      return;
    }

    try {
      setLoading(true);
      const res = await api.post("/mobile/auth/login", { api_key: apiKey.trim() });

      if (res.data.device_locked) {
        // Employee already registered on another phone — block and inform
        Alert.alert(
          "Device already registered",
          "This account is already linked to another phone. Ask your admin to reset your device access before logging in here.",
          [{ text: "OK" }]
        );
        return;
      }

      setAuth(apiKey.trim(), res.data.token, res.data.employee, res.data.device_id || null);
    } catch {
      Alert.alert("Login failed", "Invalid API key or server error. Check your key and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Enter your API Key</Text>
      <TextInput
        value={apiKey}
        onChangeText={setApiKey}
        placeholder="Paste API key"
        placeholderTextColor="#6b6460"
        style={styles.input}
        autoCapitalize="none"
      />
      <TouchableOpacity style={styles.button} onPress={onLogin} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? "Signing in..." : "Login"}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={onQrScan}>
        <Text style={styles.secondaryButtonText}>Scan QR</Text>
      </TouchableOpacity>
      <Text style={styles.note}>Scan the QR provided by the owner.</Text>

      <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>
        <View style={styles.scannerRoot}>
          <View style={styles.scannerHeader}>
            <Text style={styles.scannerTitle}>Scan API Key QR</Text>
            <TouchableOpacity style={styles.closeButton} onPress={() => setScannerOpen(false)}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.scannerBody}>
            <Camera
              style={styles.camera}
              cameraType="back"
              scanBarcode
              showFrame
              laserColor="#e8761a"
              frameColor="#e8761a"
              onReadCode={onReadCode}
            />
          </View>
        </View>
      </Modal>
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
  label: { fontSize: 14, fontWeight: "600", color: "#e8e2d9", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#3d3835",
    backgroundColor: "#2b2724",
    padding: 10,
    borderRadius: 8,
    color: "#f5f2ed",
  },
  button: {
    marginTop: 12,
    backgroundColor: "#e8761a",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
  secondaryButton: {
    marginTop: 10,
    backgroundColor: "#2b2724",
    borderWidth: 1,
    borderColor: "#3d3835",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  secondaryButtonText: { color: "#f5f2ed", fontWeight: "700" },
  note: { marginTop: 10, fontSize: 12, color: "#7a7470" },
  scannerRoot: { flex: 1, backgroundColor: "#1a1714" },
  scannerHeader: {
    paddingTop: 40,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1a1714",
  },
  scannerTitle: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  closeButton: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  closeButtonText: { color: "#1a1714", fontWeight: "700" },
  scannerBody: { flex: 1, backgroundColor: "#1a1714" },
  camera: { flex: 1 },
});
