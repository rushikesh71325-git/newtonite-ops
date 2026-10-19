import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import session from "cookie-session";
import { config } from "./config/app.config";
import connectDatabase from "./config/database.config";
import { errorHandler } from "./middlewares/errorHandler.middleware";
import { requestIdMiddleware } from "./middlewares/requestId.middleware";
import { HTTPSTATUS } from "./config/http.config";

import "./config/passport.config";
import passport from "passport";
import authRoutes from "./routes/auth.route";
import userRoutes from "./routes/user.route";
import isAuthenticated from "./middlewares/isAuthenticated.middleware";
import workspaceRoutes from "./routes/workspace.route";
import memberRoutes from "./routes/member.route";
import itemRoutes from "./routes/item.route";
import teamRoutes from "./routes/team.route";
import notificationRoutes from "./routes/notification.route";
import { requireAuthContext } from "./middlewares/authContext.middleware";
import { getAttentionController } from "./controllers/item.controller";

const app = express();
const BASE_PATH = config.BASE_PATH;

// Security and request tracking
app.use(helmet());
app.use(requestIdMiddleware);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "session",
    keys: [config.SESSION_SECRET],
    maxAge: 24 * 60 * 60 * 1000,
    secure: config.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use(
  cors({
    origin: config.FRONTEND_ORIGIN,
    credentials: true,
  })
);

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.status(HTTPSTATUS.OK).json({ status: "ok", timestamp: new Date() });
});

// Auth rate limiting (100 requests per 15 mins)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many authentication requests, please try again later." },
});

app.use(`${BASE_PATH}/auth`, authLimiter, authRoutes);
app.use(`${BASE_PATH}/user`, isAuthenticated, userRoutes);
app.use(`${BASE_PATH}/workspace`, isAuthenticated, workspaceRoutes);
app.use(`${BASE_PATH}/member`, isAuthenticated, memberRoutes);
app.use(`${BASE_PATH}/items`, isAuthenticated, itemRoutes);
app.use(`${BASE_PATH}/teams`, isAuthenticated, teamRoutes);
app.use(`${BASE_PATH}/notifications`, isAuthenticated, notificationRoutes);
app.get(`${BASE_PATH}/attention`, isAuthenticated, requireAuthContext, getAttentionController);

app.use(errorHandler);

if (process.env.NODE_ENV !== "test") {
  app.listen(config.PORT, async () => {
    console.log(`Server listening on port ${config.PORT} in ${config.NODE_ENV}`);
    await connectDatabase();
  });
}

export default app;
