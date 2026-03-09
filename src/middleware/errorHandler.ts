import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors.js";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        ...(err.params && { params: err.params }),
      },
    });
    return;
  }

  console.error("[server] Unhandled error:", err);

  res.status(500).json({
    error: { code: "SERVER_ERROR" },
  });
}
