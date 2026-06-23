import type { NotificationChannel, NotificationPayload } from "./types.js";

/**
 * Manages multiple notification channels and broadcasts messages to all enabled channels.
 */
export class NotificationManager {
  private channels: NotificationChannel[] = [];

  /**
   * Add a notification channel.
   */
  addChannel(channel: NotificationChannel): void {
    this.channels.push(channel);
  }

  /**
   * Remove a notification channel by name.
   */
  removeChannel(name: string): void {
    this.channels = this.channels.filter((ch) => ch.name !== name);
  }

  /**
   * Get all registered channels.
   */
  getChannels(): NotificationChannel[] {
    return [...this.channels];
  }

  /**
   * Send a notification to all enabled channels.
   * Returns a map of channel name -> success status.
   */
  async broadcast(payload: NotificationPayload): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    const promises = this.channels
      .filter((ch) => ch.enabled)
      .map(async (channel) => {
        try {
          results[channel.name] = await channel.send(payload);
        } catch {
          results[channel.name] = false;
        }
      });

    await Promise.all(promises);
    return results;
  }

  /**
   * Send a trade execution notification.
   */
  async notifyTradeExecuted(params: {
    symbol: string;
    side: "buy" | "sell";
    price: number;
    quantity: number;
    exchange: string;
    fee?: number;
  }): Promise<void> {
    const sideLabel = params.side === "buy" ? "BUY" : "SELL";
    const total = params.price * params.quantity;
    const feeInfo = params.fee ? `\nFee: ${params.fee.toFixed(6)}` : "";

    await this.broadcast({
      level: "success",
      title: `${sideLabel} Order Filled`,
      message: `${sideLabel} ${params.quantity} @ ${params.price}\nTotal: ${total.toFixed(2)}${feeInfo}`,
      symbol: params.symbol,
      exchange: params.exchange,
      data: {
        Side: sideLabel,
        Price: params.price.toString(),
        Quantity: params.quantity.toString(),
        Total: total.toFixed(2),
      },
    });
  }

  /**
   * Send a bot status notification.
   */
  async notifyBotStatus(params: {
    botName: string;
    status: "started" | "stopped" | "error";
    symbol: string;
    exchange?: string;
    error?: string;
  }): Promise<void> {
    const level = params.status === "error" ? "error" : params.status === "started" ? "info" : "warning";
    const statusLabel = params.status.charAt(0).toUpperCase() + params.status.slice(1);

    await this.broadcast({
      level,
      title: `Bot ${statusLabel}`,
      message: params.error ?? `Bot "${params.botName}" is now ${params.status}`,
      symbol: params.symbol,
      exchange: params.exchange,
    });
  }

  /**
   * Send a P&L summary notification.
   */
  async notifyPnLSummary(params: {
    symbol: string;
    exchange: string;
    realizedPnL: number;
    totalFees: number;
    tradeCount: number;
    avgBuyPrice: number;
  }): Promise<void> {
    const pnlSign = params.realizedPnL >= 0 ? "+" : "";

    await this.broadcast({
      level: params.realizedPnL >= 0 ? "success" : "warning",
      title: "P&L Summary",
      message: `Realized P&L: ${pnlSign}${params.realizedPnL.toFixed(2)}\nFees: ${params.totalFees.toFixed(4)}\nTrades: ${params.tradeCount}\nAvg Buy: ${params.avgBuyPrice.toFixed(2)}`,
      symbol: params.symbol,
      exchange: params.exchange,
      data: {
        "Realized P&L": `${pnlSign}${params.realizedPnL.toFixed(2)}`,
        "Total Fees": params.totalFees.toFixed(4),
        "Trade Count": params.tradeCount.toString(),
        "Avg Buy Price": params.avgBuyPrice.toFixed(2),
      },
    });
  }

  /**
   * Send a pair auto-detection notification.
   */
  async notifyPairsDetected(params: {
    exchange: string;
    pairs: Array<{ symbol: string; score: number; priceChange: number }>;
  }): Promise<void> {
    const pairList = params.pairs
      .slice(0, 10)
      .map((p, i) => `${i + 1}. ${p.symbol} (score: ${p.score}, change: ${p.priceChange.toFixed(1)}%)`)
      .join("\n");

    await this.broadcast({
      level: "info",
      title: "Pairs Auto-Detected",
      message: `Top pairs detected on ${params.exchange}:\n${pairList}`,
      exchange: params.exchange,
    });
  }
}
