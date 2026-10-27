import { Router } from "express";
import { clearUiLogs, downloadLogs, getRecentLogs } from "../controllers/logController.js";

const router = Router();

router.get("/recent", getRecentLogs);
router.get("/download", downloadLogs);
router.post("/clear-ui", clearUiLogs);

export default router;
