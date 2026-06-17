import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db/client.ts";
import {
  authAccountsTable,
  authSessionsTable,
  authVerificationsTable,
  authUsersTable,
} from "./db/schema.ts";
import type { SessionUser, UserRole } from "./shared/contracts.ts";

type BetterAuthInstance = {
  handler(request: Request): Promise<Response> | Response;
  api: {
    getSession(input: { headers: Headers }): Promise<{
      user?: {
        id?: string;
        email?: string;
        name?: string;
      };
    } | null>;
  };
};

type DynamicImport = (specifier: string) => Promise<Record<string, unknown>>;

const dynamicImport = new Function(
  "specifier",
  "return import(specifier)",
) as DynamicImport;

let authPromise: Promise<BetterAuthInstance | null> | null = null;
const localSessionCookieName = "breakfast_session";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sameConfiguredEmail(email: string, configuredEmail?: string): boolean {
  return Boolean(
    configuredEmail && normalizeEmail(email) === normalizeEmail(configuredEmail),
  );
}

export function roleForEmail(
  email: string,
  fallbackRole: UserRole = "customer",
): UserRole {
  if (sameConfiguredEmail(email, process.env.BOSS_EMAIL)) {
    return "manager";
  }

  if (
    sameConfiguredEmail(
      email,
      process.env.STAFF_EMAIL ?? process.env.DEMO_EMAIL ?? "demo@example.com",
    )
  ) {
    return "staff";
  }

  return fallbackRole;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getSessionSecret(): string {
  return process.env.BETTER_AUTH_SECRET || process.env.SESSION_SECRET || "breakfast-dev-session-secret";
}

function signPayload(payload: string): string {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(";").reduce(
    (cookies, chunk) => {
      const [rawName, ...rawValue] = chunk.trim().split("=");
      if (!rawName || rawValue.length === 0) {
        return cookies;
      }
      cookies[rawName] = rawValue.join("=");
      return cookies;
    },
    {} as Record<string, string>,
  );
}

export function createLocalSessionCookie(user: SessionUser): string {
  const expiresAt = Date.now() + 1000 * 60 * 60 * 8;
  const payload = base64UrlEncode(JSON.stringify({ ...user, expiresAt }));
  const signature = signPayload(payload);
  return `${localSessionCookieName}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800`;
}

export function clearLocalSessionCookie(): string {
  return `${localSessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function getLocalSessionUser(request: Request): SessionUser | null {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const token = cookies[localSessionCookieName];
  if (!token) {
    return null;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signPayload(payload), signature)) {
    return null;
  }

  try {
    const decoded = JSON.parse(base64UrlDecode(payload)) as Partial<SessionUser> & {
      expiresAt?: number;
    };

    if (
      !decoded.expiresAt ||
      decoded.expiresAt < Date.now() ||
      !decoded.id ||
      !decoded.email ||
      !decoded.name ||
      !decoded.role
    ) {
      return null;
    }

    return {
      id: decoded.id,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
    };
  } catch {
    return null;
  }
}

export function getAuthConfigStatus() {
  return {
    betterAuthConfigured: Boolean(
      process.env.BETTER_AUTH_URL && process.env.BETTER_AUTH_SECRET,
    ),
    googleConfigured: Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
    ),
  };
}

async function loadBetterAuth(): Promise<BetterAuthInstance | null> {
  const { betterAuthConfigured, googleConfigured } = getAuthConfigStatus();
  if (!betterAuthConfigured) {
    return null;
  }

  try {
    const betterAuthModule = await dynamicImport("better-auth");
    const adapterModule = await dynamicImport("better-auth/adapters/drizzle");
    const betterAuth = betterAuthModule.betterAuth as (config: unknown) => BetterAuthInstance;
    const drizzleAdapter = adapterModule.drizzleAdapter as (
      database: typeof db,
      config: unknown,
    ) => unknown;

    const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);

    return betterAuth({
      baseURL: process.env.BETTER_AUTH_URL,
      secret: process.env.BETTER_AUTH_SECRET,
      database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
          user: authUsersTable,
          session: authSessionsTable,
          account: authAccountsTable,
          verification: authVerificationsTable,
        },
      }),
      ...(googleConfigured
        ? {
            socialProviders: {
              google: {
                clientId: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
              },
            },
          }
        : {}),
      ...(trustedOrigins.length > 0 ? { trustedOrigins } : {}),
    });
  } catch (error) {
    console.warn("[auth] Better Auth is not available", error);
    return null;
  }
}

export async function getAuth(): Promise<BetterAuthInstance | null> {
  authPromise ??= loadBetterAuth();
  return authPromise;
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  const auth = await getAuth();
  if (!auth) {
    return Response.json(
      {
        error: "Better Auth is not configured",
        message:
          "Set BETTER_AUTH_URL, BETTER_AUTH_SECRET and install better-auth to enable Google sign-in.",
      },
      { status: 503 },
    );
  }

  return auth.handler(request);
}

export async function getSessionUser(
  request: Request,
): Promise<SessionUser | null> {
  const localSessionUser = getLocalSessionUser(request);
  if (localSessionUser) {
    return localSessionUser;
  }

  const auth = await getAuth();
  if (!auth) {
    return null;
  }

  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user?.id || !session.user.email || !session.user.name) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: roleForEmail(session.user.email),
  };
}
