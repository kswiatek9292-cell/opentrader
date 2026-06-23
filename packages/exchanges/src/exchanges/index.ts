import { ExchangeCode } from "@opentrader/types";
import { createExchange } from "./ccxt/factory.js";
import { exchangeCodeMapCCXT } from "../client/constants.js";

export const exchanges: Record<ExchangeCode, ReturnType<typeof createExchange>> = {
  [ExchangeCode.OKX]: createExchange(ExchangeCode.OKX),
  [ExchangeCode.BYBIT]: createExchange(ExchangeCode.BYBIT),
  [ExchangeCode.BITGET]: createExchange(ExchangeCode.BITGET),
  [ExchangeCode.BINANCE]: createExchange(ExchangeCode.BINANCE),
  [ExchangeCode.KRAKEN]: createExchange(ExchangeCode.KRAKEN),
  [ExchangeCode.COINBASE]: createExchange(ExchangeCode.COINBASE),
  [ExchangeCode.GATEIO]: createExchange(ExchangeCode.GATEIO),
} as const;

export { exchangeCodeMapCCXT };
export { RealisticPaperExchange } from "./ccxt/realistic-paper-exchange.js";
export type { RealisticPaperConfig, TradeLogEntry, PnLSummary } from "./ccxt/realistic-paper-exchange.js";
