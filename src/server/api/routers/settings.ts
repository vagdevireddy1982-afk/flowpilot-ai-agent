import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ROLE_DESCRIPTIONS, ROLE_PERMISSIONS } from "@/lib/auth/rbac";
import { permissionProcedure, protectedProcedure, router } from "@/server/api/trpc";
import { recordAudit } from "@/server/services/audit-service";
import { getRuntimeConfig, getSettings, updateSettings } from "@/server/services/settings-service";

export const settingsRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({
    ...ctx.user,
    permissions: ROLE_PERMISSIONS[ctx.user.role],
  })),

  organization: permissionProcedure("settings:read").query(() => getSettings()),

  runtime: permissionProcedure("settings:read").query(() => getRuntimeConfig()),

  roles: permissionProcedure("settings:read").query(async () => {
    const counts = await prisma.user.groupBy({ by: ["role"], _count: { _all: true } });
    return (["ADMIN", "AGENT", "VIEWER"] as const).map((role) => ({
      role,
      description: ROLE_DESCRIPTIONS[role],
      permissions: ROLE_PERMISSIONS[role],
      userCount: counts.find((row) => row.role === role)?._count._all ?? 0,
    }));
  }),

  users: permissionProcedure("settings:read").query(() =>
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        jobTitle: true,
        avatarColor: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ),

  updateOrganization: permissionProcedure("settings:write")
    .input(
      z.object({
        name: z.string().trim().min(2).max(80).optional(),
        supportEmail: z.string().email().optional(),
        defaultCurrency: z.enum(["INR", "USD", "EUR", "GBP"]).optional(),
        autoApproveMediumRisk: z.boolean().optional(),
        maxContextMessages: z.number().int().min(4).max(40).optional(),
        notifyOnApproval: z.boolean().optional(),
        notifyOnEscalation: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const settings = await updateSettings(input);
      await recordAudit({
        action: "settings.updated",
        actorType: "USER",
        userId: ctx.user.id,
        entityType: "OrganizationSettings",
        entityId: settings.id,
        input,
        riskLevel: "MEDIUM",
      });
      return settings;
    }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(80).optional(),
        jobTitle: z.string().trim().max(80).nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const user = await prisma.user.update({
        where: { id: ctx.user.id },
        data: input,
        select: { id: true, name: true, jobTitle: true, email: true, role: true },
      });
      await recordAudit({
        action: "profile.updated",
        actorType: "USER",
        userId: ctx.user.id,
        entityType: "User",
        entityId: user.id,
        input,
      });
      return user;
    }),

  updateUserRole: permissionProcedure("user:manage")
    .input(z.object({ userId: z.string().min(1), role: z.enum(["ADMIN", "AGENT", "VIEWER"]) }))
    .mutation(async ({ input, ctx }) => {
      const user = await prisma.user.update({
        where: { id: input.userId },
        data: { role: input.role },
        select: { id: true, name: true, role: true },
      });
      await recordAudit({
        action: "user.role_changed",
        actorType: "USER",
        userId: ctx.user.id,
        entityType: "User",
        entityId: user.id,
        input,
        riskLevel: "HIGH",
      });
      return user;
    }),
});
