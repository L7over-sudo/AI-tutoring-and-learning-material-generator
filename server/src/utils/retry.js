const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeTimeoutError(timeoutMs) {
  const error = new Error(`请求超时 ${timeoutMs}ms`);
  error.code = "REQUEST_TIMEOUT";
  return error;
}

function isTimeoutAbort(controller, parentSignal) {
  return controller.signal.aborted && !parentSignal?.aborted && controller.signal.reason?.code === "REQUEST_TIMEOUT";
}

function shouldStopRetry(error) {
  const message = error?.message || String(error || "");
  return /所有连接方式均失败|API Key 无效|401|unauthorized/i.test(message);
}

function retryWarning(attempt, error) {
  const message = error?.message || String(error || "");
  if (/socket hang up|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|Client network socket disconnected/i.test(message)) {
    return `第 ${attempt} 次连接被上游临时断开，正在自动恢复；当前任务不会直接判定失败`;
  }
  if (/图像接口未返回可保存的 base64 图片/i.test(message)) {
    return `第 ${attempt} 次收到的图像响应不完整，正在自动重新获取`;
  }
  return `第 ${attempt} 次请求未成功：${message}`;
}

export async function withTimeoutAndRetry(fn, timeoutMs = 240000, maxRetries = 2, retryDelay = 10000, logger, parentSignal) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(parentSignal.reason || new Error("任务已取消"));
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort(parentSignal.reason);
      else parentSignal.addEventListener("abort", onAbort, { once: true });
    }

    const timer = setTimeout(() => controller.abort(makeTimeoutError(timeoutMs)), timeoutMs);
    try {
      const result = await fn(controller.signal, attempt + 1);
      if (attempt > 0) logger?.info?.("retry", `第 ${attempt + 1} 次请求成功，连接已恢复`);
      return result;
    } catch (error) {
      const timeoutAbort = isTimeoutAbort(controller, parentSignal);
      lastError = timeoutAbort ? controller.signal.reason : error;
      const message = lastError?.message || String(lastError);

      if (parentSignal?.aborted || (controller.signal.aborted && !timeoutAbort)) {
        const reason = parentSignal?.reason?.message || controller.signal.reason?.message || message || "任务已取消";
        throw new Error(reason);
      }

      if (shouldStopRetry(lastError)) {
        logger?.error?.("retry", `最终失败：${message}`);
        throw lastError;
      }

      if (attempt < maxRetries) {
        const waitMs = retryDelay;
        logger?.warn?.("retry", retryWarning(attempt + 1, lastError));
        logger?.info?.("retry", `${Math.round(waitMs / 1000)} 秒后自动重试`);
        await sleep(waitMs);
      }
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener?.("abort", onAbort);
    }
  }

  logger?.error?.("retry", `最终失败：${lastError?.message || lastError}`);
  throw lastError;
}
