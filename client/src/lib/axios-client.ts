import { CustomError } from "@/types/custom-error.type";
import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE_URL;

const options = {
  baseURL,
  withCredentials: true,
  timeout: 10000,
};

const API = axios.create(options);

API.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const response = error?.response;
    const data = response?.data;
    const status = response?.status;

    // Handle 401 Unauthorized redirect safely (avoid redirect loop if already on login/auth page)
    if (status === 401) {
      const isAuthRoute =
        typeof window !== "undefined" &&
        (window.location.pathname === "/" ||
          window.location.pathname.startsWith("/login") ||
          window.location.pathname.startsWith("/auth"));
      if (!isAuthRoute && typeof window !== "undefined") {
        window.location.href = "/";
      }
    }

    const customError: CustomError = {
      ...error,
      message:
        data?.message ||
        error?.message ||
        (error?.code === "ECONNABORTED"
          ? "Request timed out. Please check your network connection."
          : "Network error occurred. Please verify your connection."),
      errorCode:
        data?.errorCode ||
        data?.code ||
        (error?.code === "ECONNABORTED" ? "TIMEOUT" : "NETWORK_ERROR"),
      code: data?.code || data?.errorCode,
      current: data?.current,
      allowedActions: data?.allowedActions,
      reason: data?.reason,
      status: status || 0,
      response,
    };

    return Promise.reject(customError);
  }
);

export default API;
