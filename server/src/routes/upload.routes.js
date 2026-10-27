import { Router } from "express";
import multer from "multer";
import { uploadDocument, uploadImages } from "../controllers/uploadController.js";
import { normalizeUploadedFileNames } from "../utils/uploadFileName.js";

const router = Router();
const maxUploadFiles = 1000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: maxUploadFiles }
});

router.post("/images", upload.array("files", maxUploadFiles), normalizeUploadedFileNames, uploadImages);
router.post("/document", upload.any(), normalizeUploadedFileNames, uploadDocument);

export default router;
