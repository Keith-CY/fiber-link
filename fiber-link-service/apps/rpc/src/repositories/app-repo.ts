import { eq } from "drizzle-orm";
import { apps, type DbClient } from "@fiber-link/db";

export type AppSecretRecord = {
  appId: string;
  hmacSecret: string;
};

export type AppRepo = {
  findByAppId(appId: string): Promise<AppSecretRecord | null>;
  upsert(input: AppSecretRecord): Promise<AppSecretRecord>;
  __resetForTests?: () => void;
};

export function createDbAppRepo(db: DbClient): AppRepo {
  return {
    async findByAppId(appId) {
      const [row] = await db
        .select({ appId: apps.appId, hmacSecret: apps.hmacSecret })
        .from(apps)
        .where(eq(apps.appId, appId))
        .limit(1);
      if (!row) {
        return null;
      }
      return row;
    },

    async upsert(input) {
      const [row] = await db
        .insert(apps)
        .values({ appId: input.appId, hmacSecret: input.hmacSecret })
        .onConflictDoUpdate({
          target: apps.appId,
          set: { hmacSecret: input.hmacSecret },
        })
        .returning({ appId: apps.appId, hmacSecret: apps.hmacSecret });
      return row;
    },
  };
}

export function createInMemoryAppRepo(initial: AppSecretRecord[] = []): AppRepo {
  const byAppId = new Map<string, string>(initial.map((item) => [item.appId, item.hmacSecret]));

  return {
    async findByAppId(appId) {
      const secret = byAppId.get(appId);
      if (!secret) {
        return null;
      }
      return { appId, hmacSecret: secret };
    },

    async upsert(input) {
      byAppId.set(input.appId, input.hmacSecret);
      return { ...input };
    },

    __resetForTests() {
      byAppId.clear();
    },
  };
}
