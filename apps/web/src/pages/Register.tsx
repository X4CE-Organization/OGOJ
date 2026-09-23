import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { Field } from '../components/ui';

export default function Register() {
  const { register, settings } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    password2: '',
    invite_code: '',
  });
  const [check, setCheck] = useState<{ available: boolean; reason: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  useEffect(() => {
    const username = form.username.trim();
    if (username.length < 3) {
      setCheck(null);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const result = await api.get<{ available: boolean; reason: string }>(
          `/api/auth/check-username?username=${encodeURIComponent(username)}`,
        );
        setCheck(result);
      } catch {
        setCheck(null);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [form.username]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (form.password !== form.password2) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      const user = await register(form);
      toast.success(`注册成功，欢迎 ${user.display_name || user.username}！`);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  if (settings.allow_register === false) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-lg font-semibold">本站暂未开放注册</h1>
        <p className="mt-2 text-sm text-slate-500">请联系管理员开通账号。</p>
        <Link to="/" className="btn-ghost mt-4">
          返回首页
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-primary">注册 {String(settings.site_name ?? 'OGOJ')}</h1>
        <p className="mt-1 text-sm text-slate-500">注册即表示同意本站用户协议</p>
      </div>
      <form onSubmit={submit} className="card space-y-4 p-6">
        <Field label="用户名" required hint="注册后不可修改（管理员可放开限制）">
          <input className="input" value={form.username} onChange={set('username')} placeholder="3-16 个字符" />
          {check && (
            <span className={`mt-1 block text-xs ${check.available ? 'text-emerald-500' : 'text-rose-500'}`}>
              {check.available ? '该用户名可以使用' : check.reason}
            </span>
          )}
        </Field>
        <Field label="邮箱" hint="用于找回密码与接收通知（可留空）">
          <input className="input" value={form.email} onChange={set('email')} placeholder="you@example.com" />
        </Field>
        <Field label="密码" required>
          <input className="input" type="password" value={form.password} onChange={set('password')} />
        </Field>
        <Field label="确认密码" required>
          <input className="input" type="password" value={form.password2} onChange={set('password2')} />
        </Field>
        {Boolean(settings.register_need_invite) && (
          <Field label="邀请码" required>
            <input className="input" value={form.invite_code} onChange={set('invite_code')} />
          </Field>
        )}
        {error && <p className="text-sm text-rose-500">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? '注册中…' : '注册'}
        </button>
        <p className="text-center text-xs text-slate-500">
          已有账号？
          <Link to="/login" className="link ml-1">
            去登录
          </Link>
        </p>
      </form>
    </div>
  );
}
