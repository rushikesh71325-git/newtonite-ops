import { ErrorRequestHandler, Response } from "express";
import { HTTPSTATUS } from "../config/http.config";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  IllegalTransitionError,
} from "../utils/appError";
import { z, ZodError } from "zod";
import { ErrorCodeEnum } from "../enums/error-code.enum";

const formatZodError = (res: Response, error: z.ZodError) => {
  const errors = error?.issues?.map((err) => ({
    field: err.path.join("."),
    message: err.message,
  }));
  return res.status(HTTPSTATUS.BAD_REQUEST).json({
    message: "Validation failed",
    errors: errors,
    errorCode: ErrorCodeEnum.VALIDATION_ERROR,
  });
};

export const errorHandler: ErrorRequestHandler = (
  error,
  req,
  res,
  next
): any => {
  console.error(`[Error] ${req.method} ${req.path} [ReqID: ${req.id || "none"}]:`, error?.message || error);

  if (error instanceof SyntaxError) {
    return res.status(HTTPSTATUS.BAD_REQUEST).json({
      message: "Invalid JSON format. Please check your request body.",
      errorCode: ErrorCodeEnum.VALIDATION_ERROR,
    });
  }

  if (error instanceof ZodError) {
    return formatZodError(res, error);
  }

  if (error instanceof ConflictError) {
    return res.status(error.statusCode).json({
      message: error.message,
      errorCode: error.errorCode,
      code: error.errorCode,
      current: error.current,
    });
  }

  if (error instanceof IllegalTransitionError) {
    return res.status(error.statusCode).json({
      message: error.message,
      errorCode: error.errorCode,
      code: error.errorCode,
      allowedActions: error.allowedActions,
    });
  }

  if (error instanceof ForbiddenError) {
    return res.status(error.statusCode).json({
      message: error.message,
      errorCode: error.errorCode,
      code: error.errorCode,
      reason: error.reason,
    });
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      message: error.message,
      errorCode: error.errorCode,
      ...(error.details ? error.details : {}),
    });
  }

  // Handle Mongoose duplicate key error (code 11000)
  if ((error as any)?.code === 11000) {
    return res.status(HTTPSTATUS.CONFLICT).json({
      message: "Duplicate key conflict",
      errorCode: "DUPLICATE_KEY_CONFLICT",
      keyPattern: (error as any).keyPattern,
    });
  }

  return res.status(HTTPSTATUS.INTERNAL_SERVER_ERROR).json({
    message: "Internal Server Error",
    errorCode: ErrorCodeEnum.INTERNAL_SERVER_ERROR,
    error: process.env.NODE_ENV === "production" ? undefined : error?.message || "Unknown error occurred",
  });
};
