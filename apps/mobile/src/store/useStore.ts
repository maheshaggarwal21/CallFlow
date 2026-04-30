import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type EmployeeInfo = {
  id: string;
  name: string;
  color_index: number;
};

type StoreState = {
  apiKey: string | null;
  token: string | null;
  employee: EmployeeInfo | null;
  deviceId: string | null;
  storagePath: string | null;
  setAuth: (apiKey: string, token: string, employee: EmployeeInfo, deviceId?: string | null) => void;
  setDevice: (deviceId: string, storagePath: string) => void;
};

export const useStore = create<StoreState>((set) => ({
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
  const apiKey = await AsyncStorage.getItem("apiKey");
  const token = await AsyncStorage.getItem("token");
  const employeeRaw = await AsyncStorage.getItem("employee");
  const deviceId = await AsyncStorage.getItem("deviceId");
  const storagePath = await AsyncStorage.getItem("storagePath");

  if (apiKey && token && employeeRaw) {
    useStore.setState({
      apiKey,
      token,
      employee: JSON.parse(employeeRaw),
      deviceId: deviceId || null,
      storagePath: storagePath || null,
    });
  }
}
