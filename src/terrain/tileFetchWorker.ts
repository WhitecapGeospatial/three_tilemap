type FetchRequest = {
  type: "fetch";
  id: string;
  demUrl: string;
  imageryUrl: string;
};

type FetchResult = {
  type: "result";
  id: string;
  demBitmap: ImageBitmap;
  imageryBitmap: ImageBitmap;
};

type FetchError = {
  type: "error";
  id: string;
  message: string;
};

self.onmessage = async (e: MessageEvent<FetchRequest>) => {
  const { id, demUrl, imageryUrl } = e.data;
  try {
    const [demBlob, imageryBlob] = await Promise.all([
      fetch(demUrl).then((r) => r.blob()),
      fetch(imageryUrl).then((r) => r.blob()),
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
    self.postMessage(
      { type: "result", id, demBitmap, imageryBitmap } satisfies FetchResult,
      { transfer: [demBitmap, imageryBitmap] },
    );
  } catch (err) {
    self.postMessage({
      type: "error",
      id,
      message: err instanceof Error ? err.message : String(err),
    } satisfies FetchError);
  }
};
