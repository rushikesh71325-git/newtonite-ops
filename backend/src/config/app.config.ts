import "dotenv/config";
import { getEnv } from "../utils/get-env";

const appConfig = () => {
  const nodeEnv = process.env.NODE_ENV || "development";
  const sessionSecret = process.env.SESSION_SECRET;

  if (nodeEnv !== "test" && !sessionSecret) {
    throw new Error("Fatal: SESSION_SECRET environment variable is required.");
  }

  const mongoUri = process.env.MONGO_URI || (nodeEnv === "test" ? "" : "mongodb://localhost:27017/newtonite_ops?replicaSet=rs0&directConnection=true");

  return {
    NODE_ENV: nodeEnv,
    PORT: getEnv("PORT", "8000"),
    BASE_PATH: getEnv("BASE_PATH", "/api"),
    MONGO_URI: mongoUri,
    SESSION_SECRET: sessionSecret || "test-session-secret-must-be-at-least-32-chars-long",
    SESSION_EXPIRES_IN: getEnv("SESSION_EXPIRES_IN", "1d"),
    FRONTEND_ORIGIN: getEnv("FRONTEND_ORIGIN", "http://localhost:5173"),
  };
};

export const config = appConfig();
