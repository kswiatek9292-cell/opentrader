export type NotificationLevel = "info" | "warning" | "error" | "success";

export interface NotificationPayload {
  level: NotificationLevel;
  title: string;
  message: string;
  symbol?: string;
  exchange?: string;
  data?: Record<string, unknown>;
  timestamp?: Date;
}

export interface NotificationChannel {
  name: string;
  enabled: boolean;
  send(payload: NotificationPayload): Promise<boolean>;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  /** Parse mode for messages */
  parseMode?: "HTML" | "MarkdownV2";
  /** Disable notification sound */
  disableNotification?: boolean;
}

export interface WebhookConfig {
  url: string;
  /** HTTP method */
  method?: "POST" | "PUT";
  /** Custom headers */
  headers?: Record<string, string>;
  /** Secret for HMAC signature verification */
  secret?: string;
}

export interface DiscordWebhookConfig {
  webhookUrl: string;
  username?: string;
  avatarUrl?: string;
}

export interface SlackWebhookConfig {
  webhookUrl: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
}
