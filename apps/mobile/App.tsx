import React, { useEffect } from "react";
import {
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import LoginScreen from "./src/screens/LoginScreen";
import DeviceSetupScreen from "./src/screens/DeviceSetupScreen";
import { hydrateStore, useStore } from "./src/store/useStore";
import { syncCallsOnce } from "./src/services/callSync";

async function requestAndroidPermissions() {
  if (Platform.OS !== "android") return;
  const permissions = [
    PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
    PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
    PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,   // Android ≤12
    (PermissionsAndroid.PERMISSIONS as any).READ_MEDIA_AUDIO, // Android 13+
    PermissionsAndroid.PERMISSIONS.FOREGROUND_SERVICE,
    PermissionsAndroid.PERMISSIONS.CAMERA,
  ].filter(Boolean) as string[];

  if (permissions.length === 0) return;
  await PermissionsAndroid.requestMultiple(permissions);
}

export default function App() {
  const token = useStore((s) => s.token);
  const deviceId = useStore((s) => s.deviceId);
  const storagePath = useStore((s) => s.storagePath);
  const apiKey = useStore((s) => s.apiKey);

  useEffect(() => {
    hydrateStore();
    requestAndroidPermissions();
  }, []);

  useEffect(() => {
    if (!token || !deviceId || !storagePath || !apiKey) return;
    const id = setInterval(() => {
      syncCallsOnce();
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [token, deviceId, storagePath, apiKey]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.title}>CallFlow Sync</Text>
        <Text style={styles.sub}>Max Music School</Text>
      </View>
      {!token && <LoginScreen />}
      {token && !deviceId && <DeviceSetupScreen />}
      {token && deviceId && (
        <View style={styles.readyBox}>
          <Text style={styles.readyTitle}>Device linked</Text>
          <Text style={styles.readyText}>Sync runs every 15 minutes.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f7f5f0", padding: 16 },
  header: { marginBottom: 12 },
  title: { fontSize: 22, fontWeight: "700", color: "#1a1714" },
  sub: { fontSize: 13, color: "#8a8278" },
  readyBox: {
    marginTop: 18,
    backgroundColor: "#fffdf9",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e8e2d9",
    padding: 16,
  },
  readyTitle: { fontSize: 16, fontWeight: "700", color: "#1a1714", marginBottom: 6 },
  readyText: { fontSize: 13, color: "#4a4540" },
});
