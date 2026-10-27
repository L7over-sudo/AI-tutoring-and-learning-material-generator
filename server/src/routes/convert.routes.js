import { Router } from "express";
import multer from "multer";
import { convertDocument, convertImages, convertImagesPpt, convertPdfWord, downloadConvertedImage, downloadConvertedPdf, downloadConvertedPpt, downloadConvertedWord, downloadConvertedZip, downloadXhsZip, stitchUploadedImages, xhsParseNote } from "../controllers/convertController.js";
import { normalizeUploadedFileNames } from "../utils/uploadFileName.js";

const router = Router();
const maxConvertFiles = 1000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: maxConvertFiles }
});
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024, files: 1 }
});

router.post("/document-to-images", documentUpload.single("file"), normalizeUploadedFileNames, convertDocument);
router.post("/images-to-pdf", upload.array("files", maxConvertFiles), normalizeUploadedFileNames, convertImages);
router.post("/images-to-ppt", upload.array("files", maxConvertFiles), normalizeUploadedFileNames, convertImagesPpt);
router.post("/images-stitch", upload.array("files", 200), normalizeUploadedFileNames, stitchUploadedImages);
router.post("/pdf-to-word", upload.single("file"), normalizeUploadedFileNames, convertPdfWord);
router.post("/xhs-parse", xhsParseNote);
router.get("/download/:jobId", downloadConvertedZip);
router.get("/xhs-download/:jobId", downloadXhsZip);
router.get("/pdf/:jobId/:fileName", downloadConvertedPdf);
router.get("/ppt/:jobId/:fileName", downloadConvertedPpt);
router.get("/word/:jobId/:fileName", downloadConvertedWord);
router.get("/image/:jobId/:fileName", downloadConvertedImage);

export default router;
