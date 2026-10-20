export { createResourceStore as createStore, keyOf } from "../../../packages/ui/src/resource-store.ts";
export type { Resource } from "../../../packages/ui/src/resource-store.ts";
import type { Store as SharedStore } from "../../../packages/ui/src/resource-store.ts";

export type Store = Omit<SharedStore, "peek">;
