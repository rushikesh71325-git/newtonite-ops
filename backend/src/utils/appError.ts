import { HTTPSTATUS, HttpStatusCodeType } from "../config/http.config";
import { ErrorCodeEnum, ErrorCodeEnumType } from "../enums/error-code.enum";

export class AppError extends Error {
  public statusCode: HttpStatusCodeType;
  public errorCode?: ErrorCodeEnumType | string;
  public details?: any;

  constructor(
    message: string,
    statusCode: HttpStatusCodeType = HTTPSTATUS.INTERNAL_SERVER_ERROR,
    errorCode?: ErrorCodeEnumType | string,
    details?: any
  ) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class HttpException extends AppError {
  constructor(
    message = "Http Exception Error",
    statusCode: HttpStatusCodeType,
    errorCode?: ErrorCodeEnumType | string,
    details?: any
  ) {
    super(message, statusCode, errorCode, details);
  }
}

export class InternalServerException extends AppError {
  constructor(message = "Internal Server Error", errorCode?: ErrorCodeEnumType | string) {
    super(
      message,
      HTTPSTATUS.INTERNAL_SERVER_ERROR,
      errorCode || ErrorCodeEnum.INTERNAL_SERVER_ERROR
    );
  }
}

export class NotFoundException extends AppError {
  constructor(message = "Resource not found", errorCode: ErrorCodeEnumType | string = ErrorCodeEnum.NOT_FOUND) {
    super(message, HTTPSTATUS.NOT_FOUND, errorCode);
  }
}

// Alias for convenience
export const NotFound = NotFoundException;
export const NotFoundError = NotFoundException;

export class BadRequestException extends AppError {
  constructor(message = "Bad Request", errorCode: ErrorCodeEnumType | string = ErrorCodeEnum.VALIDATION_ERROR, details?: any) {
    super(message, HTTPSTATUS.BAD_REQUEST, errorCode, details);
  }
}

export class UnauthorizedException extends AppError {
  constructor(message = "Unauthorized Access", errorCode: ErrorCodeEnumType | string = ErrorCodeEnum.ACCESS_UNAUTHORIZED) {
    super(message, HTTPSTATUS.UNAUTHORIZED, errorCode);
  }
}

export class ForbiddenError extends AppError {
  public reason?: string;

  constructor(opts?: { message?: string; reason?: string } | string) {
    const message = typeof opts === "string" ? opts : opts?.message || "Forbidden";
    const reason = typeof opts === "object" ? opts?.reason : undefined;
    super(message, HTTPSTATUS.FORBIDDEN, ErrorCodeEnum.FORBIDDEN, { reason });
    this.reason = reason;
  }
}

export const ForbiddenException = ForbiddenError;

export class ConflictError extends AppError {
  public current?: any;

  constructor(opts: { code?: string; message?: string; current?: any } | string) {
    if (typeof opts === "string") {
      super(opts, HTTPSTATUS.CONFLICT, ErrorCodeEnum.STALE_VERSION);
    } else {
      const code = opts.code || ErrorCodeEnum.STALE_VERSION;
      const message = opts.message || (
        code === ErrorCodeEnum.ALREADY_CLAIMED
          ? "Item has already been claimed by another user"
          : code === ErrorCodeEnum.REQUEST_IN_PROGRESS
          ? "A request with this idempotency key is currently in progress"
          : "Item was modified by another operation (stale version)"
      );
      super(message, HTTPSTATUS.CONFLICT, code, { current: opts.current });
      this.current = opts.current;
    }
  }
}

export class IllegalTransitionError extends AppError {
  public allowedActions: string[];

  constructor(opts: { message?: string; allowedActions?: string[] }) {
    const message = opts.message || "Illegal workflow transition";
    const allowedActions = opts.allowedActions || [];
    super(message, HTTPSTATUS.UNPROCESSABLE_ENTITY, ErrorCodeEnum.ILLEGAL_TRANSITION, {
      allowedActions,
    });
    this.allowedActions = allowedActions;
  }
}
