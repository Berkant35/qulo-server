import type { Request, Response, NextFunction } from "express";
import { AppError, Errors } from "../utils/errors.js";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // body-parser hataları (bozuk JSON, limit aşımı) istemci hatasıdır; herkese açık
  // uçlarda 500 + stack log gürültüsü yerine 400/413.
  const bodyErr = err as Error & { type?: string };
  if (bodyErr.type === "entity.parse.failed") err = Errors.INVALID_JSON();
  else if (bodyErr.type === "entity.too.large") err = Errors.PAYLOAD_TOO_LARGE();

  // Check both instanceof and duck-typing for AppError
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        ...(err.params && { params: err.params }),
      },
    });
    return;
  }

  // Fallback: duck-type check for AppError-like objects
  const appErr = err as AppError;
  if (appErr.code && appErr.statusCode) {
    console.warn("[server] AppError duck-typed (instanceof failed):", appErr.code, appErr.statusCode);
    res.status(appErr.statusCode).json({
      error: {
        code: appErr.code,
        ...(appErr.params && { params: appErr.params }),
      },
    });
    return;
  }

  console.error("[server] Unhandled error:", err.message, err.stack?.split("\n").slice(0, 3).join("\n"));

  res.status(500).json({
    error: { code: "SERVER_ERROR" },
  });
}
