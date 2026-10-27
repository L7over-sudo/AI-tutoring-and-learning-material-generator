import { Router } from "express";
import {
  deletePromptTemplates,
  cleanupCache,
  getCacheStatus,
  getConfig,
  listPromptTemplates,
  saveConfig,
  savePromptTemplate,
  testConfig
} from "../controllers/configController.js";

const router = Router();

router.get("/", getConfig);
router.post("/", saveConfig);
router.post("/test", testConfig);
router.get("/cache", getCacheStatus);
router.post("/cache/cleanup", cleanupCache);
router.get("/prompt-templates", listPromptTemplates);
router.post("/prompt-templates", savePromptTemplate);
router.delete("/prompt-templates", deletePromptTemplates);

export default router;
