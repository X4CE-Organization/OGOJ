export class HttpError extends Error {
  statusCode: number;
  code?: string;
  detail?: unknown;

  constructor(statusCode: number, message: string, options: { code?: string; detail?: unknown } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = options.code;
    this.detail = options.detail;
  }
}

export const badRequest = (msg: string, detail?: unknown) =>
  new HttpError(400, msg, { code: 'BAD_REQUEST', detail });
export const unauthorized = (msg = '请先登录') =>
  new HttpError(401, msg, { code: 'UNAUTHORIZED' });
export const forbidden = (msg = '没有权限执行该操作') =>
  new HttpError(403, msg, { code: 'FORBIDDEN' });
export const notFound = (msg = '资源不存在') => new HttpError(404, msg, { code: 'NOT_FOUND' });
export const conflict = (msg: string, detail?: unknown) =>
  new HttpError(409, msg, { code: 'CONFLICT', detail });
export const tooMany = (msg = '操作过于频繁，请稍后再试') =>
  new HttpError(429, msg, { code: 'TOO_MANY' });
export const serverError = (msg = '服务器内部错误') =>
  new HttpError(500, msg, { code: 'INTERNAL' });
