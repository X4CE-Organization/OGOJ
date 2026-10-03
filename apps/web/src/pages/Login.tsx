import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { Field, Modal } from '../components/ui';
import { api } from '../lib/api';
import OAuthButtons from '../components/OAuthButtons';

export default function Login() {
  const { login, settings, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgot, setForgot] = useState({ account: '', code: '', password: '', password2: '' });
  const [forgotError, setForgotError] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [mode, setMode] = useState<'password' | 'phone'>('password');
  const [phoneForm, setPhoneForm] = useState({ phone: '', code: '' });
  const [phoneCooldown, setPhoneCooldown] = useState(0);
  const [phoneError, setPhoneError] = useState('');

  const phoneLoginEnabled = settings.phone_login_enabled !== false;

  useEffect(() => {
    if (phoneCooldown <= 0) return undefined;
    const timer = setTimeout(() => setPhoneCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [phoneCooldown]);

  const sendPhoneCode = async () => {
    setPhoneError('');
    if (!phoneForm.phone.trim()) {
      setPhoneError('请填写手机号');
      return;
    }
    try {
      await api.post('/api/auth/sms-code', { phone: phoneForm.phone.trim(), purpose: 'login' });
      toast.success('验证码已发送');
      setPhoneCooldown(60);
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : '发送失败');
    }
  };

  const phoneLogin = async () => {
    setPhoneError('');
    setLoading(true);
    try {
      const data = await api.post<{ token: string; user: any }>('/api/auth/phone-login', {
        phone: phoneForm.phone.trim(),
        code: phoneForm.code.trim(),
      });
      localStorage.setItem('ogoj-token', data.token);
      await refresh?.();
      toast.success(`欢迎回来，${data.user?.display_name || data.user?.username || ''}`);
      navigate('/', { replace: true });
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const mailReady = Boolean(settings.smtp_enabled);
  const resetEnabled = settings.mail_reset_enabled !== false;

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const sendCode = async () => {
    setForgotError('');
    if (!forgot.account.trim()) {
      setForgotError('请先填写用户名或邮箱');
      return;
    }
    setSendingCode(true);
    try {
      const result = await api.post<{ masked?: string }>('/api/auth/mail-code', {
        account: forgot.account.trim(),
        purpose: 'reset',
      });
      toast.success(result.masked ? `验证码已发送至 ${result.masked}` : '如果账号存在，验证码已发送');
      setCooldown(60);
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSendingCode(false);
    }
  };

  const resetPassword = async () => {
    setForgotError('');
    if (forgot.password !== forgot.password2) {
      setForgotError('两次输入的新密码不一致');
      return;
    }
    setForgotLoading(true);
    try {
      await api.post('/api/auth/reset-password', {
        account: forgot.account.trim(),
        code: forgot.code.trim(),
        password: forgot.password,
        password2: forgot.password2,
      });
      toast.success('密码已重置，请用新密码登录');
      setForgotOpen(false);
      setForgot({ account: '', code: '', password: '', password2: '' });
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : '重置失败');
    } finally {
      setForgotLoading(false);
    }
  };

  const redirect = new URLSearchParams(location.search).get('redirect');
  const [searchParams] = useSearchParams();
  const oauthError = searchParams.get('error');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(username.trim(), password, remember);
      toast.success(`欢迎回来，${user.display_name || user.username}`);
      navigate(redirect ? '/' : '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-primary">
          <Link to="/" title="返回首页" className="transition hover:opacity-75">
            {String(settings.site_name ?? 'OGOJ')}
          </Link>
        </h1>
        <p className="mt-1 text-sm text-slate-500">登录以提交代码、参加比赛</p>
      </div>
      <div className="card space-y-4 p-6">
        {phoneLoginEnabled && (
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs dark:bg-slate-800">
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 ${mode === 'password' ? 'bg-white font-medium shadow-sm dark:bg-slate-900' : 'text-slate-500'}`}
              onClick={() => setMode('password')}
            >
              密码登录
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 ${mode === 'phone' ? 'bg-white font-medium shadow-sm dark:bg-slate-900' : 'text-slate-500'}`}
              onClick={() => setMode('phone')}
            >
              手机号登录
            </button>
          </div>
        )}

        {mode === 'phone' ? (
          <>
            <Field label="手机号" required>
              <input
                className="input"
                value={phoneForm.phone}
                onChange={(event) => setPhoneForm({ ...phoneForm, phone: event.target.value })}
                placeholder="11 位手机号"
              />
            </Field>
            <Field label="验证码" required>
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  value={phoneForm.code}
                  onChange={(event) => setPhoneForm({ ...phoneForm, code: event.target.value })}
                  placeholder="6 位数字验证码"
                />
                <button
                  type="button"
                  className="btn-ghost shrink-0"
                  disabled={phoneCooldown > 0}
                  onClick={sendPhoneCode}
                >
                  {phoneCooldown > 0 ? `${phoneCooldown} 秒后重发` : '发送验证码'}
                </button>
              </div>
            </Field>
            {phoneError && <p className="text-sm text-rose-500">{phoneError}</p>}
            <button type="button" className="btn-primary w-full" disabled={loading} onClick={phoneLogin}>
              {loading ? '登录中…' : '手机号登录'}
            </button>
            <p className="text-center text-xs text-slate-400">手机号需要先在「个人设置」里绑定</p>
          </>
        ) : (
        <form onSubmit={submit} className="space-y-4">
        <Field label="用户名 / 邮箱" required>
          <input
            className="input"
            value={username}
            autoComplete="username"
            onChange={(event) => setUsername(event.target.value)}
            placeholder="请输入用户名"
          />
        </Field>
        <Field label="密码" required>
          <input
            className="input"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="请输入密码"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-500">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          保持登录状态
        </label>
        {error && <p className="text-sm text-rose-500">{error}</p>}
        {oauthError && <p className="text-sm text-rose-500">{oauthError}</p>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? '登录中…' : '登录'}
        </button>
        {resetEnabled && mailReady && (
          <p className="text-center text-xs">
            <button
              type="button"
              className="text-slate-500 hover:text-primary"
              onClick={() => {
                setForgot({ ...forgot, account: username.trim() || forgot.account });
                setForgotError('');
                setForgotOpen(true);
              }}
            >
              忘记密码？
            </button>
          </p>
        )}
        <OAuthButtons className="pt-2" />
        {settings.allow_register !== false && (
          <p className="text-center text-xs text-slate-500">
            还没有账号？
            <Link to="/register" className="link ml-1">
              立即注册
            </Link>
          </p>
        )}
        </form>
        )}
      </div>
      <p className="text-center text-xs text-slate-400">
        登录后即可提交代码、参加比赛、兑换商店特权；遇到问题可以提交工单。
      </p>

      <Modal open={forgotOpen} title="通过邮箱找回密码" onClose={() => setForgotOpen(false)}>
        <div className="space-y-3">
          <Field label="用户名 / 邮箱" required>
            <input
              className="input"
              value={forgot.account}
              onChange={(event) => setForgot({ ...forgot, account: event.target.value })}
              placeholder="注册时使用的邮箱"
            />
          </Field>
          <Field label="邮箱验证码" required>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={forgot.code}
                onChange={(event) => setForgot({ ...forgot, code: event.target.value })}
                placeholder="6 位数字验证码"
              />
              <button
                type="button"
                className="btn-ghost shrink-0"
                disabled={sendingCode || cooldown > 0}
                onClick={sendCode}
              >
                {cooldown > 0 ? `${cooldown} 秒后重发` : sendingCode ? '发送中…' : '发送验证码'}
              </button>
            </div>
          </Field>
          <Field label="新密码" required>
            <input
              className="input"
              type="password"
              value={forgot.password}
              onChange={(event) => setForgot({ ...forgot, password: event.target.value })}
              placeholder="至少 6 位"
            />
          </Field>
          <Field label="确认新密码" required>
            <input
              className="input"
              type="password"
              value={forgot.password2}
              onChange={(event) => setForgot({ ...forgot, password2: event.target.value })}
              placeholder="再输入一次"
            />
          </Field>
          {forgotError && <p className="text-sm text-rose-500">{forgotError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost" onClick={() => setForgotOpen(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" disabled={forgotLoading} onClick={resetPassword}>
              {forgotLoading ? '提交中…' : '重置密码'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
