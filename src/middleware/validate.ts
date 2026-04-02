import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { Errors } from "../utils/errors.js";

export function validate(schema: ZodSchema, source: "body" | "query" | "params" = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const details = result.error.flatten().fieldErrors;
      return next(Errors.VALIDATION_ERROR(details as Record<string, unknown>));
    }

    (req as unknown as Record<string, unknown>)[source] = result.data;
    next();
  };
}
