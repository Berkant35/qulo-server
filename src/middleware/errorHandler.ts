import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors.js";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
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
