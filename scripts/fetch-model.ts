// Downloads MediaPipe's face model (≈3.6 MB) into the extension. It's data, not code.
import { writeFileSync, mkdirSync } from "node:fs";

const URL_ = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const res = await fetch(URL_);
if (!res.ok) throw new Error(`download failed: ${res.status}`);
mkdirSync("extension/assets", { recursive: true });
writeFileSync("extension/assets/face_landmarker.task", Buffer.from(await res.arrayBuffer()));
console.log("✅ extension/assets/face_landmarker.task (run npm run build again)");
