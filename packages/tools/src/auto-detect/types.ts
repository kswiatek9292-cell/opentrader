export interface DetectedPair {
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  volume24h: number;
  priceChange24hPercent: number;
  lastPrice: number;
  bid: number;
  ask: number;
  spread: number;
  score: number;
}

export interface PairFilterOptions {
  /** Quote currency filter, e.g. "USDT", "BTC" */
  quoteCurrency?: string;
  /** Minimum 24h volume in quote currency */
  minVolume24h?: number;
  /** Minimum absolute price change in 24h (%) — pairs with high volatility */
  minPriceChange24hPercent?: number;
  /** Maximum spread percentage — liquidity filter */
  maxSpreadPercent?: number;
  /** Only include pairs that dropped by at least this % in 24h (for DCA opportunities) */
  minDipPercent?: number;
  /** Maximum number of pairs to return */
  limit?: number;
  /** Sort by: "volume", "change", "dip", "score" */
  sortBy?: "volume" | "change" | "dip" | "score";
}

export const DEFAULT_FILTER_OPTIONS: Required<PairFilterOptions> = {
  quoteCurrency: "USDT",
  minVolume24h: 100000,
  minPriceChange24hPercent: 0,
  maxSpreadPercent: 1,
  minDipPercent: 0,
  limit: 50,
  sortBy: "score",
};
