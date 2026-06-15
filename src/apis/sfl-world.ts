import { config } from "../config.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

export type MarketType = "p2p" | "seq" | "ge";

export interface PricesResponse {
  data: {
    p2p: Record<string, number>;
    seq: Record<string, number>;
    ge: Record<string, number>;
  };
  updatedAt: number;
  updated_text: string;
}

export interface ExchangeResponse {
  sfl: Record<string, number> & { supply?: number };
  pol: Record<string, number>;
  gems: Record<
    string,
    { gem: number; usd: number; sfl1: number; sfl: number; pol: number }
  >;
  coins: Record<string, { sfl: number; coin: number; usd: number; pol: number }>;
}

let pricesCache: { data: PricesResponse; fetchedAt: number } | null = null;
let exchangeCache: { data: ExchangeResponse; fetchedAt: number } | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${url} failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<T>;
}

function isFresh(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < CACHE_TTL_MS;
}

/** dd/mm/yyyy HH:mm:ss in local timezone — always include time for API freshness */
export function formatApiDateTime(timestampMs: number): string {
  const d = new Date(timestampMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatApiTimestampLine(options: {
  updatedAt: number;
  updatedText?: string;
  fetchedAt?: number;
}): string {
  const { updatedAt, updatedText, fetchedAt } = options;
  const absolute = formatApiDateTime(updatedAt);
  const relative = updatedText ? ` (${updatedText})` : "";
  const lines = [`Data updated at: ${absolute}${relative}`];

  if (fetchedAt !== undefined && Math.abs(fetchedAt - updatedAt) > 1000) {
    lines.push(`Fetched at: ${formatApiDateTime(fetchedAt)}`);
  }

  return lines.join("\n");
}

export type PricesResult = PricesResponse & { fetchedAt: number };
export type ExchangeResult = ExchangeResponse & { fetchedAt: number };

export async function getPrices(force = false): Promise<PricesResult> {
  if (!force && pricesCache && isFresh(pricesCache.fetchedAt)) {
    return { ...pricesCache.data, fetchedAt: pricesCache.fetchedAt };
  }

  const data = await fetchJson<PricesResponse>(config.apis.pricesUrl);
  const fetchedAt = Date.now();
  pricesCache = { data, fetchedAt };
  return { ...data, fetchedAt };
}

export async function getExchange(force = false): Promise<ExchangeResult> {
  if (!force && exchangeCache && isFresh(exchangeCache.fetchedAt)) {
    return { ...exchangeCache.data, fetchedAt: exchangeCache.fetchedAt };
  }

  const data = await fetchJson<ExchangeResponse>(config.apis.exchangeUrl);
  const fetchedAt = Date.now();
  exchangeCache = { data, fetchedAt };
  return { ...data, fetchedAt };
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function findResourcePrice(
  market: Record<string, number>,
  resource: string,
): { name: string; price: number } | null {
  const needle = normalizeName(resource);

  const exact = Object.entries(market).find(
    ([name]) => normalizeName(name) === needle,
  );
  if (exact) return { name: exact[0], price: exact[1] };

  const partial = Object.entries(market).filter(([name]) =>
    normalizeName(name).includes(needle),
  );
  if (partial.length === 1) {
    return { name: partial[0]![0], price: partial[0]![1] };
  }

  return null;
}

export function searchResources(
  prices: PricesResponse,
  resource: string,
  market: MarketType = "p2p",
): Array<{ name: string; price: number; market: MarketType }> {
  const needle = normalizeName(resource);
  const markets: MarketType[] = market ? [market] : ["p2p", "seq", "ge"];
  const results: Array<{ name: string; price: number; market: MarketType }> = [];

  for (const m of markets) {
    for (const [name, price] of Object.entries(prices.data[m])) {
      if (normalizeName(name).includes(needle)) {
        results.push({ name, price, market: m });
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export function formatResourcePrices(options: {
  prices: PricesResponse & { fetchedAt?: number };
  resource?: string;
  market?: MarketType;
  limit?: number;
}): string {
  const { prices, resource, market = "p2p", limit = 30 } = options;
  const lines: string[] = [
    `# Sunflower Land Resource Prices (${market})`,
    `Source: ${config.apis.pricesUrl}`,
    formatApiTimestampLine({
      updatedAt: prices.updatedAt,
      updatedText: prices.updated_text,
      fetchedAt: prices.fetchedAt,
    }),
    "",
  ];

  if (resource) {
    const match = findResourcePrice(prices.data[market], resource);
    if (match) {
      lines.push(`**${match.name}**: ${match.price} (unit price in game currency)`);
      return lines.join("\n");
    }

    const matches = searchResources(prices, resource, market).slice(0, limit);
    if (matches.length === 0) {
      lines.push(`No resource matching "${resource}" in ${market} market.`);
      return lines.join("\n");
    }

    lines.push(`Matches for "${resource}":`, "");
    for (const item of matches) {
      lines.push(`- **${item.name}**: ${item.price}`);
    }
    return lines.join("\n");
  }

  const entries = Object.entries(prices.data[market])
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, limit);

  lines.push(`Showing ${entries.length} resources (limit ${limit}). Use \`resource\` param to filter.`, "");
  for (const [name, price] of entries) {
    lines.push(`- **${name}**: ${price}`);
  }

  return lines.join("\n");
}

export function formatExchange(options: {
  exchange: ExchangeResponse;
  fetchedAt?: number;
  section?: "sfl" | "pol" | "gems" | "coins" | "all";
}): string {
  const { exchange, fetchedAt, section = "all" } = options;
  const lines: string[] = [
    "# Sunflower Land Exchange Rates",
    `Source: ${config.apis.exchangeUrl}`,
  ];

  if (fetchedAt !== undefined) {
    lines.push(`Data fetched at: ${formatApiDateTime(fetchedAt)}`);
  }

  lines.push("");

  const appendSfl = () => {
    lines.push("## SFL", "");
    lines.push(`- **USD**: $${exchange.sfl.usd}`);
    if (exchange.sfl.eur) lines.push(`- **EUR**: €${exchange.sfl.eur}`);
    if (exchange.sfl.pol) lines.push(`- **POL**: ${exchange.sfl.pol}`);
    if (exchange.sfl.supply) lines.push(`- **Supply**: ${exchange.sfl.supply.toLocaleString()}`);
    lines.push("");
  };

  const appendPol = () => {
    lines.push("## POL", "");
    lines.push(`- **USD**: $${exchange.pol.usd}`);
    lines.push(`- **SFL**: ${exchange.pol.sfl}`);
    lines.push("");
  };

  const appendGems = () => {
    lines.push("## Gems packages", "");
    for (const pkg of Object.values(exchange.gems)) {
      lines.push(
        `- **${pkg.gem} gems**: $${pkg.usd} USD | ${pkg.sfl} SFL | ${pkg.pol} POL`,
      );
    }
    lines.push("");
  };

  const appendCoins = () => {
    lines.push("## Coins packages", "");
    for (const pkg of Object.values(exchange.coins)) {
      lines.push(
        `- **${pkg.coin} coins** (${pkg.sfl} SFL): $${pkg.usd} USD | ${pkg.pol} POL`,
      );
    }
    lines.push("");
  };

  if (section === "all" || section === "sfl") appendSfl();
  if (section === "all" || section === "pol") appendPol();
  if (section === "all" || section === "gems") appendGems();
  if (section === "all" || section === "coins") appendCoins();

  return lines.join("\n").trim();
}

export function sflToUsd(amountSfl: number, exchange: ExchangeResponse): number {
  return amountSfl * exchange.sfl.usd;
}

export function resourceToUsd(
  resourcePrice: number,
  exchange: ExchangeResponse,
): number {
  return resourcePrice * exchange.sfl.usd;
}

export type NftCollection = "collectibles" | "wearables";

export interface NftItem {
  id: number;
  name: string;
  collection: NftCollection;
  floor: number;
  lastSalePrice: number;
  supply: number;
  have_boost: number;
  boost_text: string;
}

export interface NftsResponse {
  collectibles: NftItem[];
  wearables: NftItem[];
  updatedAt: number;
}

export type NftsResult = NftsResponse & { fetchedAt: number };

let nftsCache: { data: NftsResponse; fetchedAt: number } | null = null;

export function flattenNfts(data: NftsResponse): NftItem[] {
  return [...data.collectibles, ...data.wearables].filter(
    (item) => typeof item?.name === "string" && item.name.length > 0,
  );
}

export async function getNfts(force = false): Promise<NftsResult> {
  if (!force && nftsCache && isFresh(nftsCache.fetchedAt)) {
    return { ...nftsCache.data, fetchedAt: nftsCache.fetchedAt };
  }

  const data = await fetchJson<NftsResponse>(config.apis.nftsUrl);
  const fetchedAt = Date.now();
  nftsCache = { data, fetchedAt };
  return { ...data, fetchedAt };
}

export function formatNftRecordText(item: NftItem, updatedAt: number): string {
  const lines = [
    "Sunflower Land NFT marketplace listing",
    `Source: ${config.apis.nftsUrl}`,
    `Data updated at: ${formatApiDateTime(updatedAt)}`,
    "",
    `Name: ${item.name}`,
    `Collection: ${item.collection}`,
    `NFT ID: ${item.id}`,
    `Floor price: ${item.floor} SFL`,
    `Last sale price: ${item.lastSalePrice} SFL`,
    `Supply: ${item.supply}`,
    `Has game boost (have_boost): ${item.have_boost ? "yes" : "no"}`,
  ];

  if (item.have_boost && item.boost_text) {
    lines.push(`Boost effect: ${item.boost_text}`);
  }

  return lines.join("\n");
}

export function nftFilePath(item: NftItem): string {
  return `api/sfl.world/nfts/${item.collection}/${item.id}.json`;
}

function findNftByName(items: NftItem[], name: string): NftItem[] {
  const needle = normalizeName(name);
  return items.filter(
    (item) => item.name && normalizeName(item.name).includes(needle),
  );
}

export function searchNfts(
  data: NftsResponse,
  options: {
    name?: string;
    collection?: NftCollection | "all";
    boostOnly?: boolean;
    limit?: number;
  } = {},
): NftItem[] {
  const { name, collection = "all", boostOnly = false, limit = 30 } = options;

  let items =
    collection === "all"
      ? flattenNfts(data)
      : collection === "collectibles"
        ? data.collectibles
        : data.wearables;

  if (boostOnly) {
    items = items.filter((item) => Boolean(item.have_boost));
  }

  if (name) {
    items = findNftByName(items, name);
  }

  return items
    .sort((a, b) => a.name.localeCompare(b.name) || a.collection.localeCompare(b.collection))
    .slice(0, limit);
}

export function formatNftPrices(options: {
  nfts: NftsResponse & { fetchedAt?: number };
  name?: string;
  collection?: NftCollection | "all";
  boostOnly?: boolean;
  limit?: number;
  includeUsd?: boolean;
  exchange?: ExchangeResponse;
}): string {
  const {
    nfts,
    name,
    collection = "all",
    boostOnly = false,
    limit = 30,
    includeUsd,
    exchange,
  } = options;

  const lines: string[] = [
    "# Sunflower Land NFT Floor Prices",
    `Source: ${config.apis.nftsUrl}`,
    formatApiTimestampLine({
      updatedAt: nfts.updatedAt,
      fetchedAt: nfts.fetchedAt,
    }),
    "",
  ];

  const matches = searchNfts(nfts, { name, collection, boostOnly, limit });

  if (name && matches.length === 1) {
    const item = matches[0]!;
    lines.push(formatNftListingLine(item));
    if (includeUsd && exchange) {
      lines.push(
        `USD estimate (@ $${exchange.sfl.usd}/SFL): ~$${nftToUsd(item.floor, exchange).toFixed(4)} floor`,
      );
    }
    return lines.join("\n");
  }

  if (matches.length === 0) {
    lines.push(
      boostOnly
        ? `No boost NFTs matching "${name ?? "*"}" in ${collection}.`
        : `No NFT matching "${name ?? "*"}" in ${collection}.`,
    );
    return lines.join("\n");
  }

  const filters = [
    collection !== "all" ? `collection=${collection}` : null,
    boostOnly ? "boost only" : null,
    name ? `name~"${name}"` : null,
  ]
    .filter(Boolean)
    .join(", ");

  lines.push(
    `Showing ${matches.length} NFT(s)${filters ? ` (${filters})` : ""}. Floor prices in SFL.`,
    "",
  );

  for (const item of matches) {
    lines.push(formatNftListingLine(item));
    if (includeUsd && exchange) {
      lines.push(`  USD floor ~$${nftToUsd(item.floor, exchange).toFixed(4)}`);
    }
  }

  return lines.join("\n");
}

function formatNftListingLine(item: NftItem): string {
  const boost = item.have_boost
    ? item.boost_text
      ? ` | boost: ${item.boost_text}`
      : " | has boost"
    : "";
  return `- **${item.name}** (${item.collection}): floor **${item.floor} SFL**, last sale ${item.lastSalePrice} SFL, supply ${item.supply}${boost}`;
}

export function nftToUsd(floorSfl: number, exchange: ExchangeResponse): number {
  return floorSfl * exchange.sfl.usd;
}
