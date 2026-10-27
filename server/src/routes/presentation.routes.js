import { Router } from "express";
import multer from "multer";
import { createPresentationTasks, exportPresentation, getPptExport, getPresentationPreview } from "../controllers/presentationController.js";
import { normalizeUploadedFileNames } from "../utils/uploadFileName.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 }
});

router.post("/tasks", upload.single("file"), normalizeUploadedFileNames, createPresentationTasks);
router.post("/generate", upload.single("file"), normalizeUploadedFileNames, createPresentationTasks);
router.post("/export/:batchId", exportPresentation);
router.get("/export/:batchId/status", getPptExport);
router.get("/tasks/:taskId/preview", getPresentationPreview);

export default router;
