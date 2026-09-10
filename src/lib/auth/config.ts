import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/generated/prisma/enums";

/**
 * Edge-safe half of the Auth.js configuration.
 *
 * `middleware.ts` instantiates NextAuth with exactly this object, which is why
 * it must not import Prisma, bcrypt, or anything else that cannot run on the
 * edge runtime. The credentials provider lives in `./index.ts`.
 */
export const authConfig = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role?: Role }).role ?? "VIEWER";
        token.name = user.name;
        token.email = user.email;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as Role) ?? "VIEWER";
      }
      return session;
    },
    authorized({ auth, request }) {
      const isSignedIn = Boolean(auth?.user);
      const { pathname } = request.nextUrl;
      const isPublic =
        pathname === "/" ||
        pathname.startsWith("/login") ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/_next") ||
        pathname.startsWith("/favicon");
      if (isPublic) return true;
      return isSignedIn;
    },
  },
} satisfies NextAuthConfig;
