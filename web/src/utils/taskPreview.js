export function taskPreviewUrl(task) {
  if (!task || !(task.enhancedUrl || task.generatedUrl)) return "";
  if (task.presentation && task.slidePlan?.version === 3) {
    return `/api/presentations/tasks/${encodeURIComponent(task.id)}/preview?v=${encodeURIComponent(task.updatedAt || "")}`;
  }
  return task.enhancedUrl || task.generatedUrl;
}
