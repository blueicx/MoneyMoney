import { config } from './config';
import {
  ApiResponse,
  Market,
  Orderbook,
  OrderInfo,
  Position,
  MarketStats,
  Category
} from './types';

// ============================================
// API CLIENT
// ============================================

class PredictApi {
  private baseUrl: string;
  private apiKey: string;
  private jwtToken: string | null = null;
  private graphqlUrl = 'https://graphql.predict.fun/graphql';

  constructor() {
    this.baseUrl = config.apiBaseUrl;
    this.apiKey = config.apiKey;
  }

  // ----------------------------------------
  // Helper methods
  // ----------------------------------------

  /**
   * Keyless GraphQL channel used by the public site. The REST API started
   * requiring API keys for read endpoints, so public data falls back here.
   */
  private async graphqlRequest<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(this.graphqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`GraphQL HTTP ${response.status}`);
      const payload = await response.json() as { data?: T; errors?: { message: string }[] };
      if (payload.errors?.length) throw new Error(`GraphQL error: ${payload.errors[0].message.slice(0, 160)}`);
      if (!payload.data) throw new Error('GraphQL returned no data');
      return payload.data;
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') throw new Error('GraphQL request timeout');
      throw err;
    }
  }

  private hashSlugToId(slug: string): number {
    // Stable 32-bit FNV-1a so category selection round-trips through the UI.
    let hash = 0x811c9dc5;
    for (let i = 0; i < slug.length; i++) {
      hash ^= slug.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      h['x-api-key'] = this.apiKey;
    }

    if (this.jwtToken) {
      h['Authorization'] = `Bearer ${this.jwtToken}`;
    }

    return h;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    retries = 3
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    for (let attempt = 1; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(url, {
          method,
          headers: this.headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const error = await response.text();

          // Authorization problems will not improve by hammering the endpoint.
          if (response.status === 401 || response.status === 403) {
            throw new Error(
              response.status === 401
                ? `Predict.fun authorization failed (${error.slice(0, 160)})`
                : `Predict.fun access denied (${error.slice(0, 160)})`
            );
          }

          // Special handling for rate limits
          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 5000 * attempt;

            if (attempt < retries) {
              console.log(`Rate limited, waiting ${waitTime/1000}s before retry...`);
              await new Promise(r => setTimeout(r, waitTime));
              continue;
            }
            throw new Error(`Rate limit exceeded. Please wait a moment and try again.`);
          }

          throw new Error(`API Error ${response.status}: ${error}`);
        }

        return response.json() as Promise<T>;
      } catch (err: any) {
        clearTimeout(timeout);

        const isLastAttempt = attempt === retries;
        const isRateLimit = err.message?.includes('Rate limit');
        const errorMsg = err.name === 'AbortError' ? 'timeout' : err.message;

        if (isLastAttempt) {
          if (isRateLimit) {
            throw err; // Preserve rate limit message
          }
          throw new Error(`${endpoint} failed after ${retries} attempts: ${errorMsg}`);
        }

        // Wait before retry (longer for rate limits)
        const baseDelay = isRateLimit ? 5000 : 1000;
        await new Promise(r => setTimeout(r, baseDelay * attempt));
      }
    }

    throw new Error(`${endpoint} failed`);
  }

  // ----------------------------------------
  // Authentication
  // ----------------------------------------

  async getAuthMessage(): Promise<string> {
    const res = await this.request<ApiResponse<{ message: string }>>(
      'GET',
      '/v1/auth/message'
    );
    return res.data.message;
  }

  async authenticate(signer: string, message: string, signature: string): Promise<string> {
    const res = await this.request<ApiResponse<{ token: string }>>(
      'POST',
      '/v1/auth',
      { signer, message, signature }
    );
    this.jwtToken = res.data.token;
    return this.jwtToken;
  }

  setJwtToken(token: string): void {
    this.jwtToken = token;
  }

  // ----------------------------------------
  // Markets
  // ----------------------------------------

  async getMarkets(first?: number, after?: string): Promise<ApiResponse<Market[]>> {
    let endpoint = '/v1/markets';
    const params: string[] = [];

    if (first) params.push(`first=${first}`);
    if (after) params.push(`after=${after}`);

    if (params.length > 0) {
      endpoint += '?' + params.join('&');
    }

    return this.request<ApiResponse<Market[]>>('GET', endpoint);
  }

  async getMarketById(id: number): Promise<ApiResponse<Market>> {
    return this.request<ApiResponse<Market>>('GET', `/v1/markets/${id}`);
  }

  async getMarketStats(id: number): Promise<ApiResponse<MarketStats>> {
    try {
      return await this.request<ApiResponse<MarketStats>>('GET', `/v1/markets/${id}/stats`, undefined, 1);
    } catch {
      const data = await this.graphqlRequest<{
        market: { statistics: { volumeTotalUsd: number; totalLiquidityUsd: number } | null } | null;
      }>(
        `query GetMarketStatistics($marketId: ID!) {
          market(id: $marketId) { statistics { volumeTotalUsd totalLiquidityUsd } }
        }`,
        { marketId: String(id) }
      );
      const stats = data.market?.statistics;
      return {
        success: !!stats,
        data: {
          volumeTotalUsd: stats?.volumeTotalUsd ?? 0,
          totalLiquidityUsd: stats?.totalLiquidityUsd ?? 0,
        } as MarketStats,
      };
    }
  }

  async getOrderbook(marketId: number): Promise<ApiResponse<Orderbook>> {
    try {
      return await this.request<ApiResponse<Orderbook>>('GET', `/v1/markets/${marketId}/orderbook`, undefined, 1);
    } catch {
      const data = await this.graphqlRequest<{
        market: { orderbook: { asks: [number, number][]; bids: [number, number][]; marketId: number; updateTimestampMs: number } | null } | null;
      }>(
        `query GetOrderbook($id: ID!) {
          market(id: $id) { orderbook { asks bids marketId updateTimestampMs } }
        }`,
        { id: String(marketId) }
      );
      const book = data.market?.orderbook;
      if (!book) return { success: false, data: null as unknown as Orderbook };
      return {
        success: true,
        data: {
          marketId: book.marketId || marketId,
          updateTimestampMs: Math.round(book.updateTimestampMs || Date.now()),
          asks: book.asks || [],
          bids: book.bids || [],
        },
      };
    }
  }

  // ----------------------------------------
  // Categories
  // ----------------------------------------

  async getCategories(
    first?: number,
    after?: string,
    status?: 'OPEN' | 'RESOLVED'
  ): Promise<ApiResponse<Category[]>> {
    let endpoint = '/v1/categories';
    const params: string[] = [];

    if (first) params.push(`first=${first}`);
    if (after) params.push(`after=${after}`);
    if (status) params.push(`status=${status}`);

    if (params.length > 0) {
      endpoint += '?' + params.join('&');
    }

    try {
      return await this.request<ApiResponse<Category[]>>('GET', endpoint, undefined, 1);
    } catch (error) {
      if (!/authorization failed|access denied|API Error 40[13]/i.test(String((error as Error).message))) throw error;
      return this.getCategoriesViaGraphql(first);
    }
  }

  private async getCategoriesViaGraphql(first = 50): Promise<ApiResponse<Category[]>> {
    const query = `
      query GetCategories($filter: CategoryFilterInput, $pagination: ForwardPaginationInput) {
        categories(filter: $filter, pagination: $pagination) {
          totalCount
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              slug
              title
              imageUrl
              startsAt
              endsAt
              status
              marketVariant
              statistics { volume24hUsd volumeTotalUsd }
              markets(filter: { status: OPEN }) {
                edges {
                  node {
                    id
                    title
                    question
                    chancePercentage
                    status
                    decimalPrecision
                    spreadThreshold
                    shareThreshold
                    statistics { percentageChanceChange24h volumeTotalUsd }
                    outcomes { edges { node { id name index onChainId status } } }
                  }
                }
              }
            }
          }
        }
      }`;
    const data = await this.graphqlRequest<{
      categories: {
        totalCount: number;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: { node: any }[];
      };
    }>(query, { filter: { status: 'OPEN' }, pagination: { first: Math.min(Math.max(first, 1), 100) } });

    const categories: Category[] = (data.categories?.edges || []).map(({ node }) => this.mapGraphqlCategory(node));
    return {
      success: true,
      data: categories,
      cursor: data.categories.pageInfo.hasNextPage ? data.categories.pageInfo.endCursor : null,
    };
  }

  private mapGraphqlCategory(node: any): Category {
    const slug = String(node.slug || node.id);
    const markets: Market[] = (node.markets?.edges || []).map(({ node: m }: any) => ({
      id: Number(m.id),
      imageUrl: m.imageUrl || '',
      title: m.title || '',
      question: m.question || m.title || '',
      description: '',
      status: (m.status || 'REGISTERED') as Market['status'],
      isNegRisk: false,
      isYieldBearing: false,
      feeRateBps: 0,
      resolution: null,
      oracleQuestionId: '',
      conditionId: '',
      resolverAddress: '',
      outcomes: (m.outcomes?.edges || []).map(({ node: o }: any) => ({
        name: o.name,
        indexSet: Number(o.index),
        onChainId: String(o.onChainId || ''),
        status: (o.status as 'WON' | 'LOST' | null) ?? null,
      })),
      questionIndex: null,
      spreadThreshold: Number(m.spreadThreshold || 0),
      shareThreshold: Number(m.shareThreshold || 0),
      categorySlug: slug,
      createdAt: node.startsAt || new Date().toISOString(),
      decimalPrecision: (Number(m.decimalPrecision) === 3 ? 3 : 2) as 2 | 3,
    }));

    const variant = ['DEFAULT', 'SPORTS_MATCH', 'CRYPTO_UP_DOWN'].includes(node.marketVariant)
      ? node.marketVariant
      : 'DEFAULT';

    return {
      id: this.hashSlugToId(slug),
      slug,
      title: node.title || '',
      description: '',
      imageUrl: node.imageUrl || '',
      isNegRisk: false,
      isYieldBearing: false,
      marketVariant: variant as Category['marketVariant'],
      createdAt: node.startsAt || new Date().toISOString(),
      startsAt: node.startsAt || new Date().toISOString(),
      endsAt: node.endsAt || undefined,
      isVisible: true,
      shortTitle: node.title || '',
      status: (node.status === 'RESOLVED' ? 'RESOLVED' : 'OPEN'),
      markets,
      tags: [],
    };
  }

  async getCategoryBySlug(slug: string): Promise<ApiResponse<Category>> {
    return this.request<ApiResponse<Category>>('GET', `/v1/categories/${slug}`);
  }

  // ----------------------------------------
  // Orders
  // ----------------------------------------

  async getOrders(
    status?: 'OPEN' | 'FILLED',
    first?: number,
    after?: string
  ): Promise<ApiResponse<OrderInfo[]>> {
    let endpoint = '/v1/orders';
    const params: string[] = [];

    if (status) params.push(`status=${status}`);
    if (first) params.push(`first=${first}`);
    if (after) params.push(`after=${after}`);

    if (params.length > 0) {
      endpoint += '?' + params.join('&');
    }

    return this.request<ApiResponse<OrderInfo[]>>('GET', endpoint);
  }

  async getOrderByHash(hash: string): Promise<ApiResponse<OrderInfo>> {
    return this.request<ApiResponse<OrderInfo>>('GET', `/v1/orders/${hash}`);
  }

  async createOrder(orderData: unknown): Promise<ApiResponse<{ code: string }>> {
    return this.request<ApiResponse<{ code: string }>>(
      'POST',
      '/v1/orders',
      orderData
    );
  }

  async removeOrders(ids: string[]): Promise<{
    success: boolean;
    removed: string[];
    noop: string[];
  }> {
    return this.request('POST', '/v1/orders/remove', { data: { ids } });
  }

  // ----------------------------------------
  // Positions
  // ----------------------------------------

  async getPositions(
    first?: number,
    after?: string
  ): Promise<ApiResponse<Position[]>> {
    let endpoint = '/v1/positions';
    const params: string[] = [];

    if (first) params.push(`first=${first}`);
    if (after) params.push(`after=${after}`);

    if (params.length > 0) {
      endpoint += '?' + params.join('&');
    }

    return this.request<ApiResponse<Position[]>>('GET', endpoint);
  }

  // ----------------------------------------
  // Account
  // ----------------------------------------

  async getAccount(): Promise<ApiResponse<{
    name: string;
    address: string;
    imageUrl: string | null;
    referral: { code: string | null; status: 'LOCKED' | 'UNLOCKED' };
  }>> {
    return this.request('GET', '/v1/account');
  }

  async setReferral(referralCode: string): Promise<{ success: boolean }> {
    return this.request('POST', '/v1/account/referral', {
      data: { referralCode }
    });
  }
}

// Export singleton instance
export const api = new PredictApi();
