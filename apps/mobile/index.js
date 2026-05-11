import { AppRegistry } from "react-native";
import App from "./App";
import { name as appName } from "./app.json";
import BackgroundFetch from "react-native-background-fetch";
import { hydrateStore } from "./src/store/useStore";
import { syncCallsOnce } from "./src/services/callSync";

AppRegistry.registerComponent(appName, () => App);

// Headless task: runs when Android wakes the app in the background (or when
// the app is fully terminated). hydrateStore must be called first because
// App.tsx never renders in headless mode — the store starts empty.
const headlessTask = async (event) => {
  const taskId = event.taskId;
  const isTimeout = event.timeout;
  if (!isTimeout) {
    try {
      await hydrateStore();
      await syncCallsOnce();
    } catch (err) {
      console.error("[headless] sync failed:", err);
    }
  }
  BackgroundFetch.finish(taskId);
};

BackgroundFetch.registerHeadlessTask(headlessTask);
