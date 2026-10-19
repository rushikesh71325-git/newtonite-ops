import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const incomingId = req.headers["x-request-id"];
  const requestId = (typeof incomingId === "string" && incomingId.trim().length > 0)
    ? incomingId.trim()
    : uuidv4();

  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
};
