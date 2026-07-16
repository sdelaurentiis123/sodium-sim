import { DEFAULT_PHYSICS, optimizeReactor, type ReactorPhysics } from "./reactor-engine.ts";

type WorkerRequest = {
  physics?: Partial<ReactorPhysics>;
  candidates?: number;
};
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const physics = { ...DEFAULT_PHYSICS, ...(event.data.physics ?? {}) };
    const result = optimizeReactor(physics, event.data.candidates ?? 12);
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
