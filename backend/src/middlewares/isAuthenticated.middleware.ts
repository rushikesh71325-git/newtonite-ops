import { NextFunction, Request, Response } from "express";
import { UnauthorizedException } from "../utils/appError";

const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === "test" && req.headers["x-test-user-id"]) {
    req.user = { _id: req.headers["x-test-user-id"] } as any;
    return next();
  }
  if (!req.user || !req.user._id) {
    throw new UnauthorizedException("Unauthorized. Please log in.");
  }
  next();
};

export default isAuthenticated;
