/**
 * Generic OAuth2 authorization-code client.
 *
 * Providers are described entirely by system settings (`oauth_<id>_*`), so a
 * deployment can enable GitHub / Gitee / Google with one click or point the
 * "custom" provider at any other OAuth2 service.
 */
import { bool, str } from '../settings/index.js';
import { OAUTH_PRESETS, type OAuthPreset } from '../settings/registry.js';

export interface OAuthProviderConfig extends OAuthPreset {
  clientId: string;
  clientSecret: string;
  enabled: boolean;
}

export function providerConfig(id: string): OAuthProviderConfig | null {
  const preset = OAUTH_PRESETS.find((item) => item.id === id);
  if (!preset) return null;
  return {
    ...preset,
    clientId: str(`oauth_${id}_client_id`, ''),
    clientSecret: str(`oauth_${id}_client_secret`, ''),
    authorizeUrl: str(`oauth_${id}_authorize_url`, preset.authorizeUrl),
    tokenUrl: str(`oauth_${id}_token_url`, preset.tokenUrl),
    userInfoUrl: str(`oauth_${id}_userinfo_url`, preset.userInfoUrl),
    scope: str(`oauth_${id}_scope`, preset.scope),
    enabled: bool(`oauth_${id}_enabled`, false) && Boolean(str(`oauth_${id}_client_id`, '')),
  };
}

export function enabledProviders(): OAuthProviderConfig[] {
  if (!bool('oauth_enabled', true)) return [];
  return OAUTH_PRESETS.map((preset) => providerConfig(preset.id)).filter(
    (item): item is OAuthProviderConfig => Boolean(item?.enabled),
  );
}

export function redirectBase(): string {
  const configured = str('oauth_redirect_base', '');
  const base = configured || str('site_url', 'http://localhost:8080');
  return base.replace(/\/+$/, '');
}

export function callbackUrl(providerId: string): string {
  return `${redirectBase()}/api/auth/oauth/${providerId}/callback`;
}

export function buildAuthorizeUrl(
  config: OAuthProviderConfig,
  state: string,
): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', callbackUrl(config.id));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', state);
  if (config.id === 'google') {
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'select_account');
  }
  return url.toString();
}

async function postForm(url: string, body: Record<string, string>): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

export interface OAuthProfile {
  providerUserId: string;
  username: string;
  email: string;
  avatar: string;
  raw: unknown;
}

export async function exchangeCode(
  config: OAuthProviderConfig,
  code: string,
): Promise<{ accessToken: string } | { error: string }> {
  try {
    const payload = await postForm(config.tokenUrl, {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl(config.id),
    });
    const accessToken = payload.access_token ?? payload.accessToken;
    if (!accessToken) {
      return { error: payload.error_description ?? payload.error ?? '未能获取访问令牌' };
    }
    return { accessToken: String(accessToken) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '请求令牌失败' };
  }
}

export async function fetchProfile(
  config: OAuthProviderConfig,
  accessToken: string,
): Promise<{ profile: OAuthProfile } | { error: string }> {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'OGOJ',
    };
    const response = await fetch(config.userInfoUrl, { headers });
    if (!response.ok) return { error: `获取用户信息失败（HTTP ${response.status}）` };
    const data: any = await response.json();

    const providerUserId = String(data.id ?? data.sub ?? data.user_id ?? data.login ?? '');
    if (!providerUserId) return { error: '第三方返回的用户信息缺少 id 字段' };

    let email = String(data.email ?? '');
    // GitHub only exposes the primary email through a separate endpoint.
    if (!email && config.id === 'github') {
      try {
        const emails = (await (
          await fetch('https://api.github.com/user/emails', { headers })
        ).json()) as any[];
        email = String(emails?.find((item) => item.primary)?.email ?? emails?.[0]?.email ?? '');
      } catch {
        /* ignore */
      }
    }

    return {
      profile: {
        providerUserId,
        username: String(data.login ?? data.username ?? data.name ?? `user${providerUserId}`),
        email,
        avatar: String(data.avatar_url ?? data.picture ?? data.avatar ?? ''),
        raw: data,
      },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '获取用户信息失败' };
  }
}

/** Turn a third-party nickname into a valid, unused local username. */
export function safeUsername(raw: string, exists: (name: string) => boolean): string {
  const base =
    raw
      .replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]/g, '')
      .slice(0, 12)
      .trim() || 'user';
  let candidate = base;
  if (candidate.length < 3) candidate = `${candidate}${Math.floor(Math.random() * 900 + 100)}`;
  let index = 1;
  while (exists(candidate)) {
    candidate = `${base}${index}`;
    index += 1;
  }
  return candidate;
}
