import type { DetectedPair, PairFilterOptions } from "./types.js";
import { DEFAULT_FILTER_OPTIONS } from "./types.js";

interface TickerData {
  symbol: string;
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  quoteVolume?: number | null;
  percentage?: number | null;
  baseVolume?: number | null;
}

interface MarketData {
  symbol: string;
  base: string;
  quote: string;
  type?: string;
  active?: boolean;
}

/**
 * Auto-detect and rank trading pairs based on exchange market data.
 * Designed to work with CCXT ticker and market data structures.
 */
export function detectPairs(
  tickers: Record<string, TickerData>,
  markets: Record<string, MarketData>,
  options: PairFilterOptions = {},
): DetectedPair[] {
  const opts = { ...DEFAULT_FILTER_OPTIONS, ...options };

  const pairs: DetectedPair[] = [];

  for (const [symbol, ticker] of Object.entries(tickers)) {
    const market = markets[symbol];
    if (!market) continue;

    // Only spot markets
    if (market.type && market.type !== "spot") continue;
    if (market.active === false) continue;

    // Quote currency filter
    if (opts.quoteCurrency && market.quote !== opts.quoteCurrency) continue;

    const bid = ticker.bid ?? 0;
    const ask = ticker.ask ?? 0;
    const lastPrice = ticker.last ?? 0;
    const volume24h = ticker.quoteVolume ?? (ticker.baseVolume ? (ticker.baseVolume * lastPrice) : 0);
    const priceChange24hPercent = ticker.percentage ?? 0;

    if (lastPrice <= 0) continue;

    // Volume filter
    if (volume24h < opts.minVolume24h) continue;

    // Spread calculation — skip spread filter if bid/ask not available
    const spread = (bid > 0 && ask > 0) ? ((ask - bid) / bid) * 100 : 0;
    if (bid > 0 && ask > 0 && spread > opts.maxSpreadPercent) continue;

    // Price change filter
    if (Math.abs(priceChange24hPercent) < opts.minPriceChange24hPercent) continue;

    // Dip filter (negative price change)
    if (opts.minDipPercent > 0 && priceChange24hPercent > -opts.minDipPercent) continue;

    // Composite score: high volume + high volatility + low spread = good DCA candidate
    const volumeScore = Math.min(Math.log10(volume24h + 1) / 10, 1);
    const volatilityScore = Math.min(Math.abs(priceChange24hPercent) / 20, 1);
    const spreadScore = 1 - Math.min(spread / opts.maxSpreadPercent, 1);
    const dipBonus = priceChange24hPercent < 0 ? Math.min(Math.abs(priceChange24hPercent) / 10, 0.5) : 0;

    const score = volumeScore * 0.35 + volatilityScore * 0.25 + spreadScore * 0.2 + dipBonus * 0.2;

    pairs.push({
      symbol,
      baseCurrency: market.base,
      quoteCurrency: market.quote,
      volume24h,
      priceChange24hPercent,
      lastPrice,
      bid,
      ask,
      spread,
      score: Math.round(score * 1000) / 1000,
    });
  }

  // Sort
  switch (opts.sortBy) {
    case "volume":
      pairs.sort((a, b) => b.volume24h - a.volume24h);
      break;
    case "change":
      pairs.sort((a, b) => Math.abs(b.priceChange24hPercent) - Math.abs(a.priceChange24hPercent));
      break;
    case "dip":
      pairs.sort((a, b) => a.priceChange24hPercent - b.priceChange24hPercent);
      break;
    case "score":
    default:
      pairs.sort((a, b) => b.score - a.score);
      break;
  }

  return pairs.slice(0, opts.limit);
}

/**
 * Detect pairs that are currently dipping — ideal for DCA entry.
 */
export function detectDipPairs(
  tickers: Record<string, TickerData>,
  markets: Record<string, MarketData>,
  options: PairFilterOptions = {},
): DetectedPair[] {
  return detectPairs(tickers, markets, {
    ...options,
    minDipPercent: options.minDipPercent ?? 5,
    sortBy: "dip",
  });
}

/**
 * Detect high-volume pairs — most liquid for trading.
 */
export function detectHighVolumePairs(
  tickers: Record<string, TickerData>,
  markets: Record<string, MarketData>,
  options: PairFilterOptions = {},
): DetectedPair[] {
  return detectPairs(tickers, markets, {
    ...options,
    minVolume24h: options.minVolume24h ?? 1000000,
    sortBy: "volume",
  });
}
