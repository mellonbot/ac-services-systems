/**
 * BROWSER-ONLY CAPTURE. A phone photo is 3–8 MB, and a quote needs ten of
 * them over a rooftop's cellular signal, held on the device until it is
 * sent. Each one is redrawn here at most PHOTO_EDGE pixels on its long side
 * as a JPEG, which keeps it legible for pricing at a few hundred kilobytes.
 * A photo the browser cannot decode (HEIC on Chrome) is sent as taken; the
 * gateway takes HEIC.
 */
export const PHOTO_EDGE = 1600;

const toBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export const photoBase64 = async (file: File): Promise<string> => {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (blob) return toBase64(blob);
  } catch { /* not decodable here: send it as taken */ }
  return toBase64(file);
};

/** The signature pad's ink as a PNG — the only form the gateway takes a signature in. */
export const signatureBase64 = (canvas: HTMLCanvasElement): string => canvas.toDataURL("image/png").split(",")[1]!;
