import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type EmployeeInfo = {
  id: string;
  name: string;
  color_index: number;
};

type StoreState = {
  hydrated: boolean;
  apiKey: string | null;
  token: string | null;
  employee: EmployeeInfo | null;
  deviceId: string | null;
  storagePath: string | null;
  setAuth: (apiKey: string, token: string, employee: EmployeeInfo, deviceId?: string | null) => void;
  setDevice: (deviceId: string, storagePath: string) => void;
};

export const useStore = create<StoreState>((set) => ({
  hydrated: false,
  apiKey: null,
  token: null,
  employee: null,
  deviceId: null,
  storagePath: null,
  setAuth: (apiKey, token, employee, deviceId) => {
    AsyncStorage.setItem("apiKey", apiKey);
    AsyncStorage.setItem("token", token);
    AsyncStorage.setItem("employee", JSON.stringify(employee));
    if (deviceId) AsyncStorage.setItem("deviceId", deviceId);
    set({ apiKey, token, employee, deviceId: deviceId || null });
  },
  setDevice: (deviceId, storagePath) => {
    AsyncStorage.setItem("deviceId", deviceId);
    AsyncStorage.setItem("storagePath", storagePath);
    set({ deviceId, storagePath });
  },
}));

export async function hydrateStore() {
  const [apiKey, token, employeeRaw, deviceId, storagePath] = await Promise.all([
    AsyncStorage.getItem("apiKey"),
    AsyncStorage.getItem("token"),
    AsyncStorage.getItem("employee"),
    AsyncStorage.getItem("deviceId"),
    AsyncStorage.getItem("storagePath"),
  ]);

  // Always set hydrated=true, even if not logged in, so App.tsx stops showing a blank screen
  useStore.setState({
    hydrated: true,
    apiKey: apiKey || null,
    token: token || null,
    employee: employeeRaw ? JSON.parse(employeeRaw) : null,
    deviceId: deviceId || null,
    storagePath: storagePath || null,
  });
}
