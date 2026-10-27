import { Router } from "express";
import { downloadZip, exportZip } from "../controllers/exportController.js";

const router = Router();

router.post("/zip", exportZip);
router.get("/download/:batchId", downloadZip);

export default router;
