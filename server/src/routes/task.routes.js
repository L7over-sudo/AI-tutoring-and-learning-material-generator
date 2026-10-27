import { Router } from "express";
import multer from "multer";
import { appendGenerateTasks, cancelBatch, clearHistory, createFollowUpTask, createStoryboard, deleteTask, generateFromText, generateFromTextReference, generateTasks, getBatchTasks, listBatches, regenerateTask, retryFailed } from "../controllers/taskController.js";
import { normalizeUploadedFileNames } from "../utils/uploadFileName.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 }
});

router.get("/", listBatches);
router.delete("/history", clearHistory);
router.get("/:batchId", getBatchTasks);
router.post("/generate", generateTasks);
router.post("/append-generate", appendGenerateTasks);
router.post("/:batchId/append-generate", appendGenerateTasks);
router.post("/text-image", generateFromText);
router.post("/storyboard", createStoryboard);
router.post("/text-reference-image", upload.single("referenceImage"), normalizeUploadedFileNames, generateFromTextReference);
router.post("/:taskId/follow-up", createFollowUpTask);
router.post("/:batchId/cancel", cancelBatch);
router.post("/:batchId/retry-failed", retryFailed);
router.post("/:batchId/:taskId/regenerate", regenerateTask);
router.delete("/:batchId/:taskId", deleteTask);

export default router;
