import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { Field } from '../components/ui';
import OAuthButtons from '../components/OAuthButtons';

export default function Login() {
  const { login, settings } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        <h1 className="text-2xl font-bold text-primary">{String(settings.site_name ?? 'OGOJ')}</h1>
        <p className="mt-1 text-sm text-slate-500">登录以提交代码、参加比赛</p>
      </div>
      <form onSubmit={submit} className="card space-y-4 p-6">
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
      <p className="text-center text-xs text-slate-400">
        默认超级管理员账号：root / ogoj123456（首次登录后请立即修改密码）
      </p>
    </div>
  );
}
