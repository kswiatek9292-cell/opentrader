import type { NotificationChannel, NotificationPayload, TelegramConfig } from "./types.js";

const LEVEL_ICONS: Record<string, string> = {
  info: "ℹ️",
  warning: "⚠️",
  error: "🔴",
  success: "✅",
};

/**
 * Telegram notification channel.
 * Sends trade notifications, alerts, and status updates via Telegram Bot API.
 */
export class TelegramNotification implements NotificationChannel {
  name = "telegram";
  enabled: boolean;
  private config: TelegramConfig;

  constructor(config: TelegramConfig) {
    this.config = config;
    this.enabled = !!(config.botToken && config.chatId);
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    if (!this.enabled) return false;

    const text = this.formatMessage(payload);
    const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text,
          parse_mode: this.config.parseMode ?? "HTML",
          disable_notification: this.config.disableNotification ?? false,
        }),
      });

      if (!response.ok) {
        console.error(`[Telegram] Failed to send message: ${response.status} ${response.statusText}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error("[Telegram] Error sending message:", error);
      return false;
    }
  }

  private formatMessage(payload: NotificationPayload): string {
    const icon = LEVEL_ICONS[payload.level] ?? "📋";
    const timestamp = (payload.timestamp ?? new Date()).toISOString().replace("T", " ").slice(0, 19);

    let msg = `${icon} <b>${escapeHtml(payload.title)}</b>\n`;
    msg += `${escapeHtml(payload.message)}\n`;

    if (payload.symbol) {
      msg += `\n📊 <b>Pair:</b> ${escapeHtml(payload.symbol)}`;
    }
    if (payload.exchange) {
      msg += `\n🏦 <b>Exchange:</b> ${escapeHtml(payload.exchange)}`;
    }

    if (payload.data) {
      for (const [key, value] of Object.entries(payload.data)) {
        msg += `\n<b>${escapeHtml(key)}:</b> ${escapeHtml(String(value))}`;
      }
    }

    msg += `\n\n🕐 ${timestamp}`;
    return msg;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
