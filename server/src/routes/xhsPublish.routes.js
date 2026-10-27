import { Router } from "express";
import { createXhsCopy, createXhsDraft, createXhsMerchantProduct, createXhsPublish, testXhsOfficialConnection } from "../controllers/xhsPublishController.js";

const router = Router();
router.post("/draft", createXhsDraft);
router.post("/publish", createXhsPublish);
router.post("/copy", createXhsCopy);
router.post("/product", createXhsMerchantProduct);
router.post("/official/test", testXhsOfficialConnection);
export default router;
