import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import IdempotencyRecordModel from "../models/idempotencyRecord.model";
import { HTTPSTATUS } from "../config/http.config";
import { ErrorCodeEnum } from "../enums/error-code.enum";

function computeHash(data: any): string {
  const normalized = JSON.stringify(data || {});
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export const idempotencyMiddleware: any = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  const rawKey =
    req.headers["idempotency-key"] || req.headers["x-idempotency-key"];

  if (!rawKey || typeof rawKey !== "string" || rawKey.trim().length === 0) {
    // If no idempotency key header is present, proceed normally
    return next();
  }

  const key = rawKey.trim();
  const userId = req.user?._id;
  if (!userId) {
    return next();
  }

  const rawRoute = `${req.baseUrl || ""}${req.path || ""}` || req.originalUrl;
  const route = rawRoute.replace(/\/+$/, "") || "/";
  const requestHash = computeHash(req.body);

  try {
    // Check for existing record
    const existing = await IdempotencyRecordModel.findOne({
      userId,
      route,
      key,
    });

    if (existing) {
      // 1. Verify payload hash matches
      if (existing.requestHash !== requestHash) {
        return res.status(HTTPSTATUS.UNPROCESSABLE_ENTITY).json({
          message:
            "Idempotency key was previously used with a different request payload",
          errorCode: ErrorCodeEnum.VALIDATION_ERROR,
        });
      }

      // 2. If completed, return cached response directly
      if (existing.status === "completed") {
        return res
          .status(existing.responseStatus || HTTPSTATUS.OK)
          .json(existing.responseBody);
      }

      // 3. If in progress, check if lock has expired (> 2 minutes)
      const IN_PROGRESS_EXPIRY_MS = 2 * 60 * 1000;
      const isExpired =
        existing.createdAt &&
        Date.now() - new Date(existing.createdAt).getTime() >
          IN_PROGRESS_EXPIRY_MS;

      if (!isExpired) {
        return res.status(HTTPSTATUS.CONFLICT).json({
          message:
            "A request with this idempotency key is currently in progress",
          errorCode: ErrorCodeEnum.REQUEST_IN_PROGRESS,
        });
      }

      // Expired in_progress lock: atomically take over the record
      const reclaimed = await IdempotencyRecordModel.findOneAndUpdate(
        {
          _id: existing._id,
          status: "in_progress",
          createdAt: existing.createdAt,
        },
        {
          $set: {
            requestHash,
            createdAt: new Date(),
          },
        },
        { new: true }
      );

      if (!reclaimed) {
        // Another concurrent request took over or completed
        const fresh = await IdempotencyRecordModel.findById(existing._id);
        if (fresh?.status === "completed") {
          return res
            .status(fresh.responseStatus || HTTPSTATUS.OK)
            .json(fresh.responseBody);
        }
        return res.status(HTTPSTATUS.CONFLICT).json({
          message:
            "A request with this idempotency key is currently in progress",
          errorCode: ErrorCodeEnum.REQUEST_IN_PROGRESS,
        });
      }
    } else {
      // No existing record: attempt to register in_progress record atomically
      try {
        await IdempotencyRecordModel.create({
          key,
          userId,
          route,
          requestHash,
          status: "in_progress",
          createdAt: new Date(),
        });
      } catch (insertError: any) {
        if (insertError?.code === 11000) {
          // Parallel concurrent insert collided on unique index (userId, route, key)
          const concurrentRecord = await IdempotencyRecordModel.findOne({
            userId,
            route,
            key,
          });

          if (concurrentRecord) {
            if (concurrentRecord.requestHash !== requestHash) {
              return res.status(HTTPSTATUS.UNPROCESSABLE_ENTITY).json({
                message:
                  "Idempotency key was previously used with a different request payload",
                errorCode: ErrorCodeEnum.VALIDATION_ERROR,
              });
            }
            if (concurrentRecord.status === "completed") {
              return res
                .status(concurrentRecord.responseStatus || HTTPSTATUS.OK)
                .json(concurrentRecord.responseBody);
            }

            const IN_PROGRESS_EXPIRY_MS = 2 * 60 * 1000;
            const isExpired =
              concurrentRecord.createdAt &&
              Date.now() - new Date(concurrentRecord.createdAt).getTime() >
                IN_PROGRESS_EXPIRY_MS;

            if (isExpired) {
              const reclaimed = await IdempotencyRecordModel.findOneAndUpdate(
                {
                  _id: concurrentRecord._id,
                  status: "in_progress",
                  createdAt: concurrentRecord.createdAt,
                },
                {
                  $set: {
                    requestHash,
                    createdAt: new Date(),
                  },
                },
                { new: true }
              );
              if (!reclaimed) {
                return res.status(HTTPSTATUS.CONFLICT).json({
                  message:
                    "A request with this idempotency key is currently in progress",
                  errorCode: ErrorCodeEnum.REQUEST_IN_PROGRESS,
                });
              }
            } else {
              return res.status(HTTPSTATUS.CONFLICT).json({
                message:
                  "A request with this idempotency key is currently in progress",
                errorCode: ErrorCodeEnum.REQUEST_IN_PROGRESS,
              });
            }
          }
        } else {
          throw insertError;
        }
      }
    }

    // Intercept response to store result upon successful completion
    const originalJson = res.json.bind(res);
    res.json = (body: any): Response => {
      const responseStatus = res.statusCode;

      const finishRecord = async () => {
        try {
          if (responseStatus >= 200 && responseStatus < 300) {
            // Only cache successful responses (2xx). Do NOT cache 409, 422, or client errors
            await IdempotencyRecordModel.updateOne(
              { userId, route, key },
              {
                $set: {
                  status: "completed",
                  responseStatus,
                  responseBody: body,
                },
              }
            );
          } else {
            // Delete record on 4xx/5xx so a retry after user reload gets fresh results
            await IdempotencyRecordModel.deleteOne({ userId, route, key });
          }
        } catch (err) {
          console.error("Failed to commit idempotency record:", err);
        }
      };

      finishRecord().finally(() => {
        originalJson(body);
      });

      return res;
    };

    next();
  } catch (err) {
    next(err);
  }
};
