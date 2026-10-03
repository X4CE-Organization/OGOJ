/**
 * 短信验证码：阿里云 / 腾讯云 / 自定义 HTTP 网关 / 开发模式。
 *
 * 只用 Node 内置的 crypto 与 fetch 实现各家签名，没有额外依赖。
 * 未配置或发送失败时自动降级为开发模式：验证码写进站内信与服务器日志。
 */
import crypto from 'node:crypto';
import { get, run } from '../db/index.js';
import { bool, num, str } from '../settings/index.js';
import { randomCode, sha256 } from './crypto.js';

export type SmsPurpose = 'register' | 'login' | 'reset' | 'bind';

export function smsProvider(): string {
  return str('sms_provider', 'dev') || 'dev';
}

export function smsEnabled(): boolean {
  return bool('sms_enabled', false) && smsProvider() !== 'dev';
}

/** 归一化手机号：补 +86 前缀，去掉空格与短横线 */
export function normalizePhone(input: string): string {
  let value = String(input ?? '').trim().replace(/[\s-]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  if (!value.startsWith('+') && /^1\d{10}$/.test(value)) value = `+86${value}`;
  return value;
}

export function validPhone(input: string): boolean {
  const value = normalizePhone(input);
  return /^\+\d{6,15}$/.test(value);
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  if (!bool('phone_mask', true)) return phone;
  const digits = phone.replace(/^\+/, '');
  if (digits.length < 7) return phone;
  const prefix = phone.slice(0, phone.length - digits.length + 3);
  return `${prefix}****${digits.slice(-4)}`;
}

function codeLength(): number {
  return Math.max(4, Math.min(8, num('sms_code_length', 6)));
}

/* ------------------------------------------------------------------ 发送 */

async function sendAliyun(phone: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const keyId = str('sms_aliyun_key_id', '');
  const keySecret = str('sms_aliyun_key_secret', '');
  if (!keyId || !keySecret) return { ok: false, error: '未配置阿里云 AccessKey' };

  const params: Record<string, string> = {
    AccessKeyId: keyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone.replace(/^\+/, ''),
    RegionId: 'cn-hangzhou',
    SignName: str('sms_sign_name', ''),
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: str('sms_template_code', ''),
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  };
  const query = Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key]!)}`)
    .join('&');
  const stringToSign = `POST&%2F&${encodeURIComponent(query)}`;
  const signature = crypto.createHmac('sha1', `${keySecret}&`).update(stringToSign).digest('base64');
  const body = `${query}&Signature=${encodeURIComponent(signature)}`;

  try {
    const response = await fetch('https://dysmsapi.aliyuncs.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const payload = (await response.json()) as any;
    if (payload?.Code === 'OK') return { ok: true };
    return { ok: false, error: payload?.Message ?? JSON.stringify(payload).slice(0, 200) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function sendTencent(phone: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const secretId = str('sms_tencent_secret_id', '');
  const secretKey = str('sms_tencent_secret_key', '');
  const appId = str('sms_tencent_sdk_app_id', '');
  if (!secretId || !secretKey || !appId) {
    return { ok: false, error: '未配置腾讯云 SecretId / SecretKey / SmsSdkAppId' };
  }
  const host = 'sms.tencentcloudapi.com';
  const service = 'sms';
  const payload = JSON.stringify({
    PhoneNumberSet: [phone],
    SmsSdkAppId: appId,
    SignName: str('sms_sign_name', ''),
    TemplateId: str('sms_template_code', ''),
    TemplateParamSet: [code],
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex');
  const canonical = ['POST', '/', '', `content-type:application/json; charset=utf-8\nhost:${host}\n`, 'content-type;host', hashedPayload].join('\n');
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    `${date}/${service}/tc3_request`,
    crypto.createHash('sha256').update(canonical).digest('hex'),
  ].join('\n');
  const hmac = (key: Buffer | string, message: string) =>
    crypto.createHmac('sha256', key).update(message).digest();
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${date}/${service}/tc3_request, ` +
    `SignedHeaders=content-type;host, Signature=${signature}`;

  try {
    const response = await fetch(`https://${host}/`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        Host: host,
        'X-TC-Action': 'SendSms',
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Version': '2021-01-11',
        'X-TC-Region': 'ap-guangzhou',
      },
      body: payload,
    });
    const result = (await response.json()) as any;
    const detail = result?.Response ?? {};
    if (detail.Error) return { ok: false, error: detail.Error.Message ?? '发送失败' };
    const status = detail.SendStatusSet?.[0];
    if (status?.Code === 'Ok') return { ok: true };
    return { ok: false, error: JSON.stringify(status ?? detail).slice(0, 200) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function sendCustom(phone: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const url = str('sms_custom_url', '').trim();
  if (!url) return { ok: false, error: '未配置自定义短信网关地址' };
  const template = str('sms_custom_body', '{"phone":"{phone}","code":"{code}"}');
  const body = template
    .replace(/\{phone\}/g, phone)
    .replace(/\{code\}/g, code)
    .replace(/\{sign\}/g, str('sms_sign_name', ''))
    .replace(/\{template\}/g, str('sms_template_code', ''));
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const text = await response.text();
    const marker = str('sms_custom_success_key', '"ok":true');
    if (marker && !text.includes(marker)) {
      return { ok: false, error: text.slice(0, 200) || '网关未返回成功标识' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function sendSms(phone: string, code: string): Promise<{ ok: boolean; dev?: boolean; error?: string }> {
  const provider = smsProvider();
  if (!bool('sms_enabled', false) || provider === 'dev') {
    return { ok: false, dev: true, error: '短信服务未启用（开发模式）' };
  }
  if (provider === 'aliyun') return sendAliyun(phone, code);
  if (provider === 'tencent') return sendTencent(phone, code);
  if (provider === 'custom') return sendCustom(phone, code);
  return { ok: false, error: `未知的短信服务商：${provider}` };
}

/* ---------------------------------------------------------------- 验证码 */

export async function recentSmsCodes(phone: string, purpose: string, seconds: number): Promise<number> {
  const row = await get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM sms_codes
      WHERE phone = ? AND purpose = ? AND created_at > datetime('now', ?)`,
    [phone, purpose, `-${Math.max(1, seconds)} seconds`],
  );
  return Number(row?.c ?? 0);
}

export async function todaySmsCount(phone: string): Promise<number> {
  const row = await get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM sms_codes WHERE phone = ? AND created_at >= date('now')`,
    [phone],
  );
  return Number(row?.c ?? 0);
}

export async function issueSmsCode(phone: string, purpose: SmsPurpose, userId?: number | null): Promise<string> {
  const code = randomCode(codeLength(), '0123456789');
  const ttl = Math.max(1, num('sms_code_ttl_minutes', 10));
  await run('UPDATE sms_codes SET used = 1 WHERE phone = ? AND purpose = ? AND used = 0', [phone, purpose]);
  await run(
    `INSERT INTO sms_codes (phone, code, purpose, user_id, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', ?))`,
    [phone, sha256(code), purpose, userId ?? null, `+${ttl} minutes`],
  );
  return code;
}

export async function consumeSmsCode(phone: string, purpose: string, code: string): Promise<boolean> {
  const row = await get<{ id: number; code: string; attempts: number }>(
    `SELECT id, code, attempts FROM sms_codes
      WHERE phone = ? AND purpose = ? AND used = 0 AND expires_at > datetime('now')
      ORDER BY id DESC LIMIT 1`,
    [phone, purpose],
  );
  if (!row || row.attempts >= 5) return false;
  if (row.code !== sha256(String(code).trim())) {
    await run('UPDATE sms_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    return false;
  }
  await run('UPDATE sms_codes SET used = 1 WHERE id = ?', [row.id]);
  return true;
}

export async function userByPhone(phone: string): Promise<{ id: number; username: string } | undefined> {
  return get<{ id: number; username: string }>('SELECT id, username FROM users WHERE phone = ?', [phone]);
}
