import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/config";

/**
 * Coarse route guard (Next.js "proxy", formerly middleware).
 *
 * Real authorization happens in every tRPC procedure and server component;
 * this only keeps signed-out visitors out of the app shell. It runs on the
 * edge runtime, which is why `authConfig` must stay free of Prisma and bcrypt.
 */
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg).*)"],
};
