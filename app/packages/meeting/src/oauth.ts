// OAuth 2.0 refresh-token grant against Google's token endpoint. The access token is cached until shortly
// before expiry and shared by concurrent callers. Token values and client secrets are kept in private fields
// and never appear in errors or in `console.log(provider)`.

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export class OAuthTokenError extends Error {
  /** `code`: Google's OAuth error code (e.g. `invalid_grant`), `network`, `http_<status>` or `bad_response`. */
  constructor(readonly code: string, readonly status?: number) {
    super(`oauth token request failed: ${code}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'OAuthTokenError';
  }
}

export interface RefreshTokenProviderOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Refresh this long before the reported expiry. Default 60 s. */
  skewMs?: number;
  timeoutMs?: number;
  tokenUrl?: string;
}

interface Cached { token: string; expiresAt: number; scopes: string[] }

export class RefreshTokenProvider {
  readonly #options: RefreshTokenProviderOptions;
  #cached: Cached | undefined;
  #pending: Promise<Cached> | undefined;
  /** Number of token endpoint calls made (for tests and run logs; no values). */
  exchanges = 0;

  constructor(options: RefreshTokenProviderOptions) {
    for (const field of ['clientId', 'clientSecret', 'refreshToken'] as const) if (!options[field]) throw new OAuthTokenError(`missing_${field}`);
    this.#options = options;
  }

  /** Scopes granted with the current token, once one has been fetched. */
  get scopes(): string[] | undefined { return this.#cached?.scopes; }
  /** Milliseconds until the cached token expires, if one is cached. */
  get expiresInMs(): number | undefined { return this.#cached ? this.#cached.expiresAt - this.#now() : undefined; }

  #now() { return (this.#options.now ?? Date.now)(); }

  /** Bound so it can be passed directly as `accessToken` to the Google adapter. */
  readonly accessToken = async (): Promise<string> => {
    const skew = this.#options.skewMs ?? 60_000;
    if (this.#cached && this.#now() < this.#cached.expiresAt - skew) return this.#cached.token;
    this.#pending ??= this.#exchange().finally(() => { this.#pending = undefined; });
    return (await this.#pending).token;
  };

  async #exchange(): Promise<Cached> {
    this.exchanges += 1;
    const { clientId, clientSecret, refreshToken } = this.#options;
    let response: Response;
    try {
      response = await (this.#options.fetch ?? fetch)(this.#options.tokenUrl ?? GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }).toString(),
        signal: AbortSignal.timeout(this.#options.timeoutMs ?? 20_000),
      });
    } catch { throw new OAuthTokenError('network'); }
    const body = await response.json().catch(() => undefined) as { access_token?: unknown; expires_in?: unknown; scope?: unknown; error?: unknown } | undefined;
    if (!response.ok) {
      const code = typeof body?.error === 'string' && /^[a-z_]{1,40}$/.test(body.error) ? body.error : `http_${response.status}`;
      throw new OAuthTokenError(code, response.status);
    }
    if (typeof body?.access_token !== 'string' || !body.access_token) throw new OAuthTokenError('bad_response', response.status);
    const expiresIn = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600;
    const scopes = typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : [];
    this.#cached = { token: body.access_token, expiresAt: this.#now() + expiresIn * 1000, scopes };
    return this.#cached;
  }

  toJSON() { return { kind: 'RefreshTokenProvider', cached: this.#cached !== undefined, scopes: this.scopes ?? [] }; }
}
