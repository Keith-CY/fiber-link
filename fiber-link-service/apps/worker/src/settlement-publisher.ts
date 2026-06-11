export type SettlementPublishOptions = {
  settledAt?: Date | null;
};

export interface SettlementPublisher {
  publish(invoice: string, options?: SettlementPublishOptions): Promise<void>;
  close(): Promise<void>;
}

export class NoopSettlementPublisher implements SettlementPublisher {
  async publish(_invoice: string, _options?: SettlementPublishOptions): Promise<void> {}
  async close(): Promise<void> {}
}

export class RedisSettlementPublisher implements SettlementPublisher {
  constructor(
    private readonly redisPublish: (channel: string, message: string) => Promise<unknown>,
    private readonly closeClient: () => Promise<void> = async () => {},
  ) {}

  async publish(invoice: string, options?: SettlementPublishOptions): Promise<void> {
    const channel = `fiber-link:settlement:${invoice}`;
    const settledAt = options?.settledAt ?? new Date();
    const message = JSON.stringify({
      invoice,
      status: "SETTLED",
      settledAt: settledAt.toISOString(),
    });
    await this.redisPublish(channel, message);
  }

  async close(): Promise<void> {
    await this.closeClient();
  }

  static create(redisUrl: string): RedisSettlementPublisher {
    // Import lazily so the worker can run without Redis when the env var is absent.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require("ioredis");
    const client = new Redis(redisUrl, { lazyConnect: true });
    return new RedisSettlementPublisher(
      (channel, message) => client.publish(channel, message),
      async () => {
        await client.quit().catch(() => client.disconnect());
      },
    );
  }
}

export function createSettlementPublisher(): SettlementPublisher {
  const redisUrl = process.env.FIBER_LINK_NONCE_REDIS_URL ?? process.env.REDIS_URL;
  if (redisUrl) {
    return RedisSettlementPublisher.create(redisUrl);
  }
  return new NoopSettlementPublisher();
}
