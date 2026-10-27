function cjkCount(text = "") {
  return (String(text).match(/[\u3400-\u9fff]/g) || []).length;
}

function mojibakeScore(text = "") {
  const value = String(text);
  return (
    (value.match(/[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßà-ÿ]/g) || []).length +
    (value.match(/�/g) || []).length * 3
  );
}

export function decodeUploadFileName(name = "") {
  const original = String(name || "");
  if (!original) return original;

  const decoded = Buffer.from(original, "latin1").toString("utf8");
  if (!decoded || decoded.includes("�")) return original;

  const originalScore = mojibakeScore(original);
  const decodedScore = mojibakeScore(decoded);
  const cjkImproved = cjkCount(decoded) > cjkCount(original);
  const scoreImproved = originalScore > 0 && decodedScore < originalScore;

  return cjkImproved || scoreImproved ? decoded : original;
}

export function normalizeUploadedFileNames(req, res, next) {
  const files = [
    ...(Array.isArray(req.files) ? req.files : []),
    ...(req.file ? [req.file] : [])
  ];

  for (const file of files) {
    file.rawOriginalName = file.originalname;
    file.originalname = decodeUploadFileName(file.originalname);
  }

  next();
}
