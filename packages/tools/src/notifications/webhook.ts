import { createHmac } from "node:crypto";
import type {
  NotificationChannel,
  NotificationPayload,
  WebhookConfig,
  DiscordWebhookConfig,
  SlackWebhookConfig,
} from "./types.js";

/**
 * Generic webhook notification channel.
 */
export class WebhookNotification implements NotificationChannel {
  name = "webhook";
  enabled: boolean;
  private config: WebhookConfig;

  constructor(config: WebhookConfig) {
    this.config = config;
    this.enabled = !!config.url;
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    if (!this.enabled) return false;

    const body = JSON.stringify({
      ...payload,
      timestamp: (payload.timestamp ?? new Date()).toISOString(),
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    if (this.config.secret) {
      const signature = createHmac("sha256", this.config.secret).update(body).digest("hex");
      headers["X-Signature"] = signature;
    }

    try {
      const response = await fetch(this.config.url, {
        method: this.config.method ?? "POST",
        headers,
        body,
      });

      if (!response.ok) {
        console.error(`[Webhook] Failed: ${response.status} ${response.statusText}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error("[Webhook] Error:", error);
      return false;
    }
  }
}

/**
 * Discord webhook notification channel.
 */
export class DiscordNotification implements NotificationChannel {
  name = "discord";
  enabled: boolean;
  private config: DiscordWebhookConfig;

  constructor(config: DiscordWebhookConfig) {
    this.config = config;
    this.enabled = !!config.webhookUrl;
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    if (!this.enabled) return false;

    const color = {
      info: 3447003,
      warning: 16776960,
      error: 15158332,
      success: 3066993,
    }[payload.level] ?? 3447003;

    const fields = [];
    if (payload.symbol) fields.push({ name: "Pair", value: payload.symbol, inline: true });
    if (payload.exchange) fields.push({ name: "Exchange", value: payload.exchange, inline: true });
    if (payload.data) {
      for (const [key, value] of Object.entries(payload.data)) {
        fields.push({ name: key, value: String(value), inline: true });
      }
    }

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.config.username ?? "OpenTrader Bot",
          avatar_url: this.config.avatarUrl,
          embeds: [
            {
              title: payload.title,
              description: payload.message,
              color,
              fields,
              timestamp: (payload.timestamp ?? new Date()).toISOString(),
            },
          ],
        }),
      });

      if (!response.ok) {
        console.error(`[Discord] Failed: ${response.status} ${response.statusText}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error("[Discord] Error:", error);
      return false;
    }
  }
}

/**
 * Slack webhook notification channel.
 */
export class SlackNotification implements NotificationChannel {
  name = "slack";
  enabled: boolean;
  private config: SlackWebhookConfig;

  constructor(config: SlackWebhookConfig) {
    this.config = config;
    this.enabled = !!config.webhookUrl;
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    if (!this.enabled) return false;

    const emoji = { info: ":information_source:", warning: ":warning:", error: ":red_circle:", success: ":white_check_mark:" }[payload.level] ?? ":memo:";

    let text = `${emoji} *${payload.title}*\n${payload.message}`;
    if (payload.symbol) text += `\n*Pair:* ${payload.symbol}`;
    if (payload.exchange) text += `\n*Exchange:* ${payload.exchange}`;
    if (payload.data) {
      for (const [key, value] of Object.entries(payload.data)) {
        text += `\n*${key}:* ${value}`;
      }
    }

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: this.config.channel,
          username: this.config.username ?? "OpenTrader Bot",
          icon_emoji: this.config.iconEmoji ?? ":robot_face:",
          text,
        }),
      });

      if (!response.ok) {
        console.error(`[Slack] Failed: ${response.status} ${response.statusText}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error("[Slack] Error:", error);
      return false;
    }
  }
}
