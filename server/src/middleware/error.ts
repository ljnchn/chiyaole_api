import type { Context, ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ValidationError } from "../utils/validate";
import { WechatApiError } from "../services/wechat";

const WECHAT_ERROR_MAP: Record<number, { code: number; message: string; status: ContentfulStatusCode }> = {
  40029: { code: 40103, message: "微信登录 code 无效或已过期，请重新调用 wx.login()", status: 400 },
  45011: { code: 40104, message: "微信接口调用频率限制，请稍后重试", status: 429 },
  40226: { code: 40105, message: "该用户已被微信封禁，无法登录", status: 403 },
  40163: { code: 40103, message: "微信登录 code 已被使用，请重新调用 wx.login()", status: 400 },
};

export const onError: ErrorHandler = (err, c) => {
  if (
    err instanceof ValidationError ||
    (err instanceof Error && err.name === "ValidationError")
  ) {
    return c.json({ code: 40001, message: err.message, data: null }, 400);
  }

  if (
    err instanceof WechatApiError ||
    (err instanceof Error && err.name === "WechatApiError")
  ) {
    const wxErr = err as WechatApiError;
    const mapped = WECHAT_ERROR_MAP[wxErr.errcode];
    if (mapped) {
      return c.json(
        { code: mapped.code, message: mapped.message, data: null },
        mapped.status
      );
    }
    console.error("Unmapped WeChat error:", wxErr.errcode, wxErr.message);
    return c.json(
      { code: 50001, message: "微信接口调用失败，请稍后重试", data: null },
      502
    );
  }

  const message = err instanceof Error ? err.message : "服务端内部错误";
  console.error("Unhandled error:", err);
  return c.json({ code: 50000, message, data: null }, 500);
};

export function success(c: Context, data: unknown, status: ContentfulStatusCode = 200) {
  return c.json({ code: 0, message: "ok", data }, status);
}

export function error(
  c: Context,
  code: number,
  message: string,
  httpStatus: ContentfulStatusCode = 400
) {
  return c.json({ code, message, data: null }, httpStatus);
}
