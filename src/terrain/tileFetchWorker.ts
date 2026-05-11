type FetchRequest = {
  type: "fetch";
  id: string;
  demUrl: string;
  imageryUrl: string;
};

type CancelRequest = {
  type: "cancel";
  id: string;
};

type CancelAllRequest = {
  type: "cancelAll";
};

type WorkerMessage = FetchRequest | CancelRequest | CancelAllRequest;

type FetchResult = {
  type: "result";
  id: string;
  demBitmap: ImageBitmap;
  imageryBitmap: ImageBitmap;
};

type FetchCancelled = {
  type: "cancelled";
  id: string;
};

type FetchError = {
  type: "error";
  id: string;
  message: string;
};

const inflight = new Map<string, AbortController>();

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === "cancel") {
    const controller = inflight.get(msg.id);
    if (controller) {
      controller.abort();
      inflight.delete(msg.id);
    }
    return;
  }

  if (msg.type === "cancelAll") {
    for (const controller of inflight.values()) {
      controller.abort();
    }
    inflight.clear();
    return;
  }

  const { id, demUrl, imageryUrl } = msg;

  const prev = inflight.get(id);
  if (prev) prev.abort();

  const controller = new AbortController();
  inflight.set(id, controller);
  const { signal } = controller;

  (async () => {
    try {
      const [demBlob, imageryBlob] = await Promise.all([
        fetch(demUrl, { signal }).then((r) => r.blob()),
        fetch(imageryUrl, { signal }).then((r) => r.blob()),
      ]);
      const [demBitmap, imageryBitmap] = await Promise.all([
        createImageBitmap(demBlob, {
          colorSpaceConversion: "none",
          premultiplyAlpha: "none",
        }),
        createImageBitmap(imageryBlob, {
          colorSpaceConversion: "none",
          premultiplyAlpha: "none",
        }),
      ]);
      inflight.delete(id);
      self.postMessage(
        { type: "result", id, demBitmap, imageryBitmap } satisfies FetchResult,
        { transfer: [demBitmap, imageryBitmap] },
      );
    } catch (err) {
      inflight.delete(id);
      if (signal.aborted) {
        self.postMessage({ type: "cancelled", id } satisfies FetchCancelled);
        return;
      }
      self.postMessage({
        type: "error",
        id,
        message: err instanceof Error ? err.message : String(err),
      } satisfies FetchError);
    }
  })();
};
