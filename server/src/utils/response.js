export function ok(res, data = {}, message = "ok") {
  return res.json({ success: true, message, ...data });
}

export function fail(res, message = "请求失败", status = 400, data = {}) {
  return res.status(status).json({ success: false, message, ...data });
}
