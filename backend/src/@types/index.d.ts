import { UserDocument } from "../models/user.model";
import { PolicyContext } from "../policy/policy";

declare global {
  namespace Express {
    interface User extends UserDocument {
      _id?: any;
    }
    interface Request {
      id?: string;
      policyCtx?: PolicyContext;
    }
  }
}
