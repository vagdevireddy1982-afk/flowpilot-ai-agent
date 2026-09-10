import { env, resolveEmailProvider } from "@/lib/env";
import { providerError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export interface OutboundEmail {
  to: string;
  from: string;
  subject: string;
  body: string;
}

export interface EmailDeliveryResult {
  providerId: string;
  provider: string;
  deliveredAt: Date;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutboundEmail): Promise<EmailDeliveryResult>;
}

/**
 * Local/demo provider. Nothing leaves the machine — the message is persisted
 * by the email service and rendered in the in-app "Sent email" inbox.
 */
export class MockEmailProvider implements EmailProvider {
  readonly name = "mock";

  async send(email: OutboundEmail): Promise<EmailDeliveryResult> {
    logger.info("email.mock_send", { to: email.to, subject: email.subject });
    return {
      providerId: `mock_${Date.now().toString(36)}`,
      provider: this.name,
      deliveredAt: new Date(),
    };
  }
}

/**
 * Resend implementation. Selected when EMAIL_PROVIDER=resend and an API key is
 * present; the rest of the application is unaware of which one is active.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(private readonly apiKey: string) {}

  async send(email: OutboundEmail): Promise<EmailDeliveryResult> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: email.from,
        to: [email.to],
        subject: email.subject,
        text: email.body,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw providerError(
        `The email provider rejected the message (${response.status}).`,
        new Error(detail.slice(0, 500)),
      );
    }

    const payload = (await response.json()) as { id?: string };
    return {
      providerId: payload.id ?? "unknown",
      provider: this.name,
      deliveredAt: new Date(),
    };
  }
}

let cached: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  cached =
    resolveEmailProvider() === "resend"
      ? new ResendEmailProvider(env.RESEND_API_KEY!)
      : new MockEmailProvider();
  return cached;
}
