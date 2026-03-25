export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function requireString(
  value: unknown,
  field: string,
  minLen = 1,
  maxLen = 255
): string {
  if (typeof value !== "string" || value.length < minLen || value.length > maxLen) {
    throw new ValidationError(
      `参数错误：${field} 需为 ${minLen}-${maxLen} 字符的字符串`
    );
  }
  return value;
}

export function optionalString(
  value: unknown,
  field: string,
  maxLen = 255
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > maxLen) {
    throw new ValidationError(
      `参数错误：${field} 需为最多 ${maxLen} 字符的字符串`
    );
  }
  return value;
}

export function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: T[]
): T {
  if (!allowed.includes(value as T)) {
    throw new ValidationError(
      `参数错误：${field} 需为 ${allowed.join("/")} 之一`
    );
  }
  return value as T;
}

export function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: T[]
): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireEnum(value, field, allowed);
}

export function optionalNumber(
  value: unknown,
  field: string,
  min?: number,
  max?: number
): number | undefined {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === "number" ? value : Number(value);
  if (isNaN(num)) {
    throw new ValidationError(`参数错误：${field} 需为数字`);
  }
  if (min !== undefined && num < min) {
    throw new ValidationError(`参数错误：${field} 不能小于 ${min}`);
  }
  if (max !== undefined && num > max) {
    throw new ValidationError(`参数错误：${field} 不能大于 ${max}`);
  }
  return num;
}

export function requireNumber(
  value: unknown,
  field: string,
  min?: number,
  max?: number
): number {
  const result = optionalNumber(value, field, min, max);
  if (result === undefined) {
    throw new ValidationError(`参数错误：${field} 不能为空`);
  }
  return result;
}

export function optionalTimeArray(
  value: unknown,
  field: string
): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new ValidationError(`参数错误：${field} 需为数组`);
  }
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  for (const item of value) {
    if (typeof item !== "string" || !timeRegex.test(item)) {
      throw new ValidationError(
        `参数错误：${field} 元素需为 HH:mm 格式`
      );
    }
  }
  return value as string[];
}

export function optionalBoolean(
  value: unknown,
  field: string
): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new ValidationError(`参数错误：${field} 需为布尔值`);
  }
  return value;
}

export function validateDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`参数错误：${field} 需为 YYYY-MM-DD 格式`);
  }
  return value;
}

export function optionalDate(
  value: unknown,
  field: string
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return validateDate(value, field);
}

export function parsePagination(query: Record<string, string>) {
  const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(query.pageSize || "20", 10) || 20)
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}
