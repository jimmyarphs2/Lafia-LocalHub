import {
  EventEngine,
  InMemoryStore,
} from "@jimmyarphs2/orbit-os-core";
import type {
  EventEngine as EventEngineType,
  InMemoryStore as InMemoryStoreType,
} from "@jimmyarphs2/orbit-os-core";

import type { LocalHubOrbitEvent, OrbitEventSink } from "./localhub-bridge";

export type OrbitCoreEventSink = OrbitEventSink & {
  readonly store: InMemoryStoreType;
  readonly engine: EventEngineType;
};

export type OrbitCoreEventSinkOptions = {
  store?: InMemoryStoreType;
  engine?: EventEngineType;
};

export function createOrbitCoreEventSink(
  options: OrbitCoreEventSinkOptions = {},
): OrbitCoreEventSink {
  const store = options.store ?? new InMemoryStore();
  const engine = options.engine ?? new EventEngine({ store });

  return Object.freeze({
    store,
    engine,
    ingest(event: LocalHubOrbitEvent) {
      return engine.ingest(event);
    },
  });
}
