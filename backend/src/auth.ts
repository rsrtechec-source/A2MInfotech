import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export type Role = "student" | "trainer" | "admin";
export type AuthUser = { id: number; name: string; email: string; role: Role };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set to at least 32 characters.");
  }
  return jwt.sign(user, secret, { expiresIn: "7d" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const secret = process.env.JWT_SECRET;
  if (!token || !secret || secret.length < 32) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  try {
    req.user = jwt.verify(token, secret) as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: "Your session is invalid or expired. Please sign in again." });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "You do not have permission to perform this action." });
      return;
    }
    next();
  };
}
