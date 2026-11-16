import { useSyncExternalStore } from "react";
import { appStore } from "./store";
export function useAppStore() {
  return useSyncExternalStore(
    appStore.subscribe,
    appStore.getSnapshot,
    appStore.getSnapshot,
  );
}
