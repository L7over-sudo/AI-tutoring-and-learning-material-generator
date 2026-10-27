import axios from "axios";

const NETWORK_ERROR_TEXT = "网络连接不稳定：暂时无法连接到 API 服务，请确认代理软件和节点可用后重试。";
const ENGLISH_NETWORK_ERROR_RE = /ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|ENOENT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|AggregateError|TLS|Client network socket disconnected|socket hang up|fetch failed|Request failed with status code/i;

function cleanMessage(message) {
  if (!message) return message;
  return ENGLISH_NETWORK_ERROR_RE.test(String(message)) ? NETWORK_ERROR_TEXT : message;
}

export const api = axios.create({
  baseURL: "/api",
  timeout: 120000
});

api.interceptors.response.use(
  (response) => {
    if (response?.data?.message) response.data.message = cleanMessage(response.data.message);
    if (response?.data?.error) response.data.error = cleanMessage(response.data.error);
    return response;
  },
  (error) => {
    if (error?.response?.data?.message) error.response.data.message = cleanMessage(error.response.data.message);
    if (error?.response?.data?.error) error.response.data.error = cleanMessage(error.response.data.error);
    error.message = cleanMessage(error.message) || error.message;
    return Promise.reject(error);
  }
);

export const fileUrl = (url) => url || "";
