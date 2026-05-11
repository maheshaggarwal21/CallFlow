import React, { useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import BackgroundFetch from "react-native-background-fetch";
import LoginScreen from "./src/screens/LoginScreen";
import DeviceSetupScreen from "./src/screens/DeviceSetupScreen";
import SyncStatusScreen from "./src/screens/SyncStatusScreen";
import { hydrateStore, useStore } from "./src/store/useStore";
import { syncCallsOnce } from "./src/services/callSync";

async function requestAndroidPermissions() {
  if (Platform.OS !== "android") return;
  const androidVersion =
    typeof Platform.Version === "number" ? Platform.Version : Number(Platform.Version);

  // Standard permissions via requestMultiple
  const permissions = [
    PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
    PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
    PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,            // Android ≤12
    (PermissionsAndroid.PERMISSIONS as any).READ_MEDIA_AUDIO,        // Android 13+
    PermissionsAndroid.PERMISSIONS.FOREGROUND_SERVICE,
    PermissionsAndroid.PERMISSIONS.CAMERA,
  ].filter(Boolean) as string[];

  if (permissions.length > 0) {
    await PermissionsAndroid.requestMultiple(permissions);
  }

  // MANAGE_EXTERNAL_STORAGE (Android 11+) cannot be granted via requestMultiple —
  // it requires the user to enable "All files access" manually in system settings.
  if (androidVersion >= 30) {
    const RNFS = require("react-native-fs");
    const testPath = RNFS.ExternalStorageDirectoryPath;
    let hasAccess = false;
    try {
      await RNFS.readDir(testPath);
      hasAccess = true;
    } catch {
      hasAccess = false;
    }

    if (!hasAccess) {
      Alert.alert(
        "All files access needed",
        "Enable 'All files access' for CallFlow in system settings so call recordings can be read.",
        [
          {
            text: "Open Settings",
            onPress: () =>
              Linking.sendIntent(
                "android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION",
                []
              ).catch(() => Linking.openSettings()),
          },
          { text: "Later", style: "cancel" },
        ]
      );
    }
  }
}

export default function App() {
  const hydrated  = useStore((s) => s.hydrated);
  const token     = useStore((s) => s.token);
  const deviceId  = useStore((s) => s.deviceId);
  const storagePath = useStore((s) => s.storagePath);
  const apiKey    = useStore((s) => s.apiKey);

  // Hydrate store from AsyncStorage once on mount
  useEffect(() => {
    hydrateStore();
    requestAndroidPermissions();
  }, []);

  // Configure BackgroundFetch once the user is fully set up.
  // This replaces setInterval — BackgroundFetch uses WorkManager on Android so
  // the sync runs even when the app is backgrounded or the screen is off.
  useEffect(() => {
    if (!token || !deviceId || !storagePath || !apiKey) return;

    BackgroundFetch.configure(
      {
        minimumFetchInterval: 15,    // minutes
        enableHeadless: true,        // runs headlessTask in index.js when app is killed
        startOnBoot: true,
        stopOnTerminate: false,      // keep running after app swipe-close
        requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
      },
      async (taskId) => {
        await syncCallsOnce();
        BackgroundFetch.finish(taskId);
      },
      async (taskId) => {
        // Timeout handler — finish immediately so Android doesn't ANR
        BackgroundFetch.finish(taskId);
      }
    );

    return () => {
      BackgroundFetch.stop();
    };
  }, [token, deviceId, storagePath, apiKey]);

  // Show a blank screen while AsyncStorage is being read — prevents the login
  // screen from flashing for already-logged-in users
  if (!hydrated) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color="#e8761a" />
      </SafeAreaView>
    );
  }

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
          <Text style={styles.readyText}>Sync runs every 15 minutes in background.</Text>
        </View>
      )}
      {token && <SyncStatusScreen />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: "#f7f5f0", justifyContent: "center", alignItems: "center" },
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
