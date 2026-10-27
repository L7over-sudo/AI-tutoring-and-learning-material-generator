import { api } from "./client";

export function createXhsDraft(payload) {
  return api.post("/xhs-publish/draft", payload, { timeout: 320000 });
}

export function publishXhsNote(payload) {
  return api.post("/xhs-publish/publish", payload, { timeout: 320000 });
}

export function generateXhsCopy(payload) {
  return api.post("/xhs-publish/copy", payload, { timeout: 70000 });
}

export function createXhsProduct(payload) {
  return api.post("/xhs-publish/product", payload, { timeout: 650000 });
}

export function testXhsOfficialApi(payload) {
  return api.post("/xhs-publish/official/test", payload, { timeout: 30000 });
}
