import type { Context, ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ValidationError } from "../utils/validate";

export const onError: ErrorHandler = (err, c) => {
  if (
    err instanceof ValidationError ||
    (err instanceof Error && err.name === "ValidationError")
  ) {
    return c.json({ code: 40001, message: err.message, data: null }, 400);
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
