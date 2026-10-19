export interface CustomError extends Error {
  errorCode?: string;
  code?: string;
  status?: number;
  response?: any;
  current?: any;
  allowedActions?: string[];
  reason?: string;
}
