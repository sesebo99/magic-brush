import { InferenceClient } from "@huggingface/inference";
import sharp from "sharp";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "8mb",
    },
  },
};

const MODEL = "Qwen/Qwen-Image-Edit";
const PROVIDER = "fal-ai";

function dataUrlToBuffer(dataUrl) {
  if (typeof dataUrl !== "string") throw new Error("Invalid image data");
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) throw new Error("Invalid data URL");
  return Buffer.from(match[1], "base64");
}

async function findMaskBox(maskBuffer) {
  const { data, info } = await sharp(maskBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = info.width, minY = info.height;
  let maxX = -1, maxY = -1;

  for (let y = 0; y < info.height; y++) {
    const row = y * info.width;
    for (let x = 0; x < info.width; x++) {
      if (data[row + x] > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;

  // AIã«å¨è¾ºæå ±ãè¦ããããã®ä½ç½ã
  const pad = Math.max(32, Math.round(Math.max(info.width, info.height) * 0.06));

  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(info.width - 1, maxX + pad);
  maxY = Math.min(info.height - 1, maxY + pad);

  // å°ããããåãåºããé¿ãã
  const minCrop = Math.min(256, Math.min(info.width, info.height));
  let width = maxX - minX + 1;
  let height = maxY - minY + 1;

  if (width < minCrop) {
    const extra = minCrop - width;
    minX = Math.max(0, minX - Math.floor(extra / 2));
    maxX = Math.min(info.width - 1, minX + minCrop - 1);
    width = maxX - minX + 1;
  }

  if (height < minCrop) {
    const extra = minCrop - height;
    minY = Math.max(0, minY - Math.floor(extra / 2));
    maxY = Math.min(info.height - 1, minY + minCrop - 1);
    height = maxY - minY + 1;
  }

  return { left: minX, top: minY, width, height };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  const token = process.env.HF_TOKEN;
  if (!token) {
    return res.status(500).send(
      "HF_TOKEN is not set. Vercelã®Environment Variablesã«HF_TOKENãè¨­å®ãã¦ãã ããã"
    );
  }

  try {
    const { image, mask, prompt } = req.body || {};

    if (!image || !mask || !prompt?.trim()) {
      return res.status(400).send("image, mask, prompt are required.");
    }

    const imageBuffer = dataUrlToBuffer(image);
    const maskBuffer = dataUrlToBuffer(mask);

    const imageMeta = await sharp(imageBuffer).metadata();
    const maskMeta = await sharp(maskBuffer).metadata();

    if (!imageMeta.width || !imageMeta.height) {
      return res.status(400).send("Could not read source image.");
    }

    if (
      imageMeta.width !== maskMeta.width ||
      imageMeta.height !== maskMeta.height
    ) {
      return res.status(400).send(
        `Image/mask size mismatch: image=${imageMeta.width}x${imageMeta.height}, mask=${maskMeta.width}x${maskMeta.height}`
      );
    }

    const box = await findMaskBox(maskBuffer);
    if (!box) {
      return res.status(400).send("Mask is empty. Paint the area to edit.");
    }

    // åç»åãããé¸æç¯å²ï¼å¨å²ããåãåºã
    // Qwen Image Editã¯image-to-imageæ¹å¼ãªã®ã§ããããAIã«æ¸¡ãã
    const cropBuffer = await sharp(imageBuffer)
      .extract(box)
      .png()
      .toBuffer();

    const hf = new InferenceClient(token);

    const editedBlob = await hf.imageToImage({
      model: MODEL,
      provider: PROVIDER,
      inputs: new Blob([cropBuffer], { type: "image/png" }),
      parameters: {
        prompt: prompt.trim(),
        num_inference_steps: 28,
      },
    });

    const editedBuffer = Buffer.from(await editedBlob.arrayBuffer());

    // AIã®åºåãåã®åãåºããµã¤ãºã«åãããã
    const fitted = await sharp(editedBuffer)
      .resize(box.width, box.height, {
        fit: "fill",
      })
      .png()
      .toBuffer();

    // AIåºåã¯åãåºãé åã«éå®ãã¦åç»åã¸åæã
    // ãã®ãããAIãå¨å²ã¾ã§å¤æ´ãã¦ãå¨ä½ç»åã«ã¯åºããã¾ããã
    const result = await sharp(imageBuffer)
      .composite([
        {
          input: fitted,
          left: box.left,
          top: box.top,
          blend: "over",
        },
      ])
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(result);

  } catch (error) {
    console.error("MAGIC_BRUSH_ERROR", error);

    const message =
      error?.message ||
      error?.response?.body ||
      String(error);

    return res.status(500).send(
      `AIç·¨éã¨ã©ã¼: ${message}`.slice(0, 1800)
    );
  }
}