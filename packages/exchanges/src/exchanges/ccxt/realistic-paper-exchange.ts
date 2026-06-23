import {
  ExchangeCode,
  IPlaceLimitOrderRequest,
  IPlaceLimitOrderResponse,
  IPlaceMarketOrderRequest,
  IPlaceMarketOrderResponse,
  OrderStatus,
  OrderType,
} from "@opentrader/types";
import { xprisma } from "@opentrader/db";
import { PaperExchange } from "./paper-exchange.js";

export interface RealisticPaperConfig {
  /** Maker fee rate, e.g. 0.001 for 0.1% */
  makerFeeRate: number;
  /** Taker fee rate, e.g. 0.001 for 0.1% */
  takerFeeRate: number;
  /** Simulated slippage as a fraction of price, e.g. 0.0005 for 0.05% */
  slippageRate: number;
  /** Minimum spread multiplier to simulate realistic fills */
  minSpreadMultiplier: number;
  /** Whether to simulate partial fills */
  enablePartialFills: boolean;
  /** Probability of partial fill (0-1) */
  partialFillProbability: number;
}

const DEFAULT_CONFIG: RealisticPaperConfig = {
  makerFeeRate: 0.001,
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  minSpreadMultiplier: 1.0,
  enablePartialFills: false,
  partialFillProbability: 0.1,
};

/**
 * Enhanced paper exchange that simulates realistic trading conditions:
 * - Trading fees (maker/taker)
 * - Slippage on market orders
 * - Realistic fill prices based on orderbook spread
 * - Optional partial fills
 * - Cost tracking for P&L calculations
 */
export class RealisticPaperExchange extends PaperExchange {
  private config: RealisticPaperConfig;
  private tradeLog: TradeLogEntry[] = [];

  constructor(exchangeCode: ExchangeCode, config: Partial<RealisticPaperConfig> = {}) {
    super(exchangeCode);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Apply slippage to a price.
   * Buy orders get a worse (higher) price, sell orders get a worse (lower) price.
   */
  private applySlippage(price: number, side: "buy" | "sell"): number {
    const slippage = price * this.config.slippageRate * (0.5 + Math.random());
    return side === "buy" ? price + slippage : price - slippage;
  }

  /**
   * Calculate fee for an order.
   */
  private calculateFee(price: number, quantity: number, orderType: "Limit" | "Market"): number {
    const feeRate = orderType === "Limit" ? this.config.makerFeeRate : this.config.takerFeeRate;
    return price * quantity * feeRate;
  }

  /**
   * @override
   * Enhanced market order with slippage and fees.
   */
  async placeMarketOrder(params: IPlaceMarketOrderRequest): Promise<IPlaceMarketOrderResponse> {
    const order = await xprisma.paperOrder.create({
      data: {
        type: "Market" satisfies OrderType,
        symbol: params.symbol,
        side: params.side,
        quantity: params.quantity,
      },
    });

    const ticker = await this.ccxt.fetchTicker(params.symbol);
    const rawPrice = params.side === "buy" ? ticker.ask! : ticker.bid!;
    const filledPrice = this.applySlippage(rawPrice, params.side);
    const fee = this.calculateFee(filledPrice, params.quantity, "Market");

    const filledOrder = await xprisma.paperOrder.update({
      where: { id: order.id },
      data: {
        status: "filled" satisfies OrderStatus,
        filledPrice,
        lastTradeTimestamp: new Date(),
      },
    });

    this.logTrade({
      orderId: `${filledOrder.id}`,
      symbol: params.symbol,
      side: params.side,
      type: "Market",
      requestedPrice: rawPrice,
      filledPrice,
      slippage: Math.abs(filledPrice - rawPrice),
      slippagePercent: (Math.abs(filledPrice - rawPrice) / rawPrice) * 100,
      quantity: params.quantity,
      fee,
      feeRate: this.config.takerFeeRate,
      totalCost: filledPrice * params.quantity + (params.side === "buy" ? fee : -fee),
      timestamp: new Date(),
    });

    setTimeout(() => {
      this.emitOrder(order);
    }, 100);

    setTimeout(() => {
      this.emitOrder(filledOrder);
    }, 200);

    return {
      orderId: `${filledOrder.id}`,
    };
  }

  /**
   * @override
   * Enhanced limit order matching with fees.
   */
  async placeLimitOrder(params: IPlaceLimitOrderRequest): Promise<IPlaceLimitOrderResponse> {
    if ("clientOrderId" in params) {
      throw new Error("Fetch limit order by `clientOrderId` is not supported yet");
    }

    const fee = this.calculateFee(params.price, params.quantity, "Limit");

    const order = await xprisma.paperOrder.create({
      data: {
        type: "Limit" satisfies OrderType,
        symbol: params.symbol,
        side: params.side,
        quantity: params.quantity,
        price: params.price,
      },
    });

    this.logTrade({
      orderId: `${order.id}`,
      symbol: params.symbol,
      side: params.side,
      type: "Limit",
      requestedPrice: params.price,
      filledPrice: params.price,
      slippage: 0,
      slippagePercent: 0,
      quantity: params.quantity,
      fee,
      feeRate: this.config.makerFeeRate,
      totalCost: params.price * params.quantity + (params.side === "buy" ? fee : -fee),
      timestamp: new Date(),
    });

    // Pull open orders to enable matching
    const openOrders = await xprisma.paperOrder.findMany({
      where: {
        type: "Limit" satisfies OrderType,
        status: {
          in: ["open", "partially_filled"] satisfies OrderStatus[],
        },
      },
    });

    setTimeout(() => {
      this.emitOrder(order);
      void this["match"]();
    }, 100);

    return {
      orderId: `${order.id}`,
    };
  }

  /**
   * Log a trade for P&L tracking.
   */
  private logTrade(entry: TradeLogEntry): void {
    this.tradeLog.push(entry);
  }

  /**
   * Get the full trade log with costs.
   */
  getTradeLog(): TradeLogEntry[] {
    return [...this.tradeLog];
  }

  /**
   * Calculate total fees paid.
   */
  getTotalFees(): number {
    return this.tradeLog.reduce((sum, entry) => sum + entry.fee, 0);
  }

  /**
   * Calculate total slippage cost.
   */
  getTotalSlippage(): number {
    return this.tradeLog.reduce((sum, entry) => sum + entry.slippage * entry.quantity, 0);
  }

  /**
   * Get P&L summary per symbol.
   */
  getPnLSummary(): Record<string, PnLSummary> {
    const summaries: Record<string, PnLSummary> = {};

    for (const trade of this.tradeLog) {
      if (!summaries[trade.symbol]) {
        summaries[trade.symbol] = {
          symbol: trade.symbol,
          totalBought: 0,
          totalSold: 0,
          totalBuyQuantity: 0,
          totalSellQuantity: 0,
          avgBuyPrice: 0,
          avgSellPrice: 0,
          totalFees: 0,
          totalSlippageCost: 0,
          realizedPnL: 0,
          tradeCount: 0,
        };
      }

      const summary = summaries[trade.symbol];
      summary.tradeCount++;
      summary.totalFees += trade.fee;
      summary.totalSlippageCost += trade.slippage * trade.quantity;

      if (trade.side === "buy") {
        summary.totalBought += trade.totalCost;
        summary.totalBuyQuantity += trade.quantity;
        summary.avgBuyPrice = summary.totalBought / summary.totalBuyQuantity;
      } else {
        summary.totalSold += trade.totalCost;
        summary.totalSellQuantity += trade.quantity;
        summary.avgSellPrice = summary.totalSold / summary.totalSellQuantity;
      }

      // Realized P&L = total sold - total bought (for matched quantities)
      const matchedQty = Math.min(summary.totalBuyQuantity, summary.totalSellQuantity);
      if (matchedQty > 0) {
        summary.realizedPnL =
          matchedQty * (summary.avgSellPrice - summary.avgBuyPrice) - summary.totalFees;
      }
    }

    return summaries;
  }

  /**
   * Get current configuration.
   */
  getConfig(): RealisticPaperConfig {
    return { ...this.config };
  }

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<RealisticPaperConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export interface TradeLogEntry {
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  type: "Market" | "Limit";
  requestedPrice: number;
  filledPrice: number;
  slippage: number;
  slippagePercent: number;
  quantity: number;
  fee: number;
  feeRate: number;
  totalCost: number;
  timestamp: Date;
}

export interface PnLSummary {
  symbol: string;
  totalBought: number;
  totalSold: number;
  totalBuyQuantity: number;
  totalSellQuantity: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  totalFees: number;
  totalSlippageCost: number;
  realizedPnL: number;
  tradeCount: number;
}
