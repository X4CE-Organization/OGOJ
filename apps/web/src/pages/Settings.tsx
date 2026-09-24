import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatTime } from '../lib/format';
import { Field, Loading, Section } from '../components/ui';
import { useToast } from '../components/Toast';
import OAuthButtons from '../components/OAuthButtons';
import { Link2, Trash2 } from 'lucide-react';
import ImageUploadField from '../components/ImageUploadField';

export default function SettingsPage() {
  const { user, profile, refresh, settings } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    display_name: '',
    bio: '',
    school: '',
    ccf_level: '',
    gender: 0,
    email: '',
    theme: 'light',
    is_private: false,
    show_email: false,
    avatar: '',
    banner: '',
  });
  const [password, setPassword] = useState({ old_password: '', new_password: '', new_password2: '' });
  const [points, setPoints] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [bindings, setBindings] = useState<{ bindings: any[]; providers: any[] } | null>(null);

  const loadBindings = () => {
    api
      .get<{ bindings: any[]; providers: any[] }>('/api/auth/oauth/bindings')
      .then(setBindings)
      .catch(() => undefined);
  };

  useEffect(() => {
    if (!user || !profile) return;
    setForm({
      display_name: user.display_name ?? user.username,
      bio: profile.bio ?? '',
      school: profile.school ?? '',
      ccf_level: profile.ccfLevel ?? '',
      gender: profile.gender ?? 0,
      email: profile.email ?? '',
      theme: profile.theme ?? 'light',
      is_private: Boolean(profile.isPrivate),
      show_email: Boolean(profile.showEmail),
      avatar: user.avatar ?? '',
      banner: user.banner ?? '',
    });
    api
      .get<any>(`/api/users/${encodeURIComponent(user.username)}/points`)
      .then(setPoints)
      .catch(() => undefined);
    loadBindings();
  }, [user, profile]);

  const unbind = async (provider: string) => {
    if (!window.confirm(`确定要解绑 ${provider} 吗？解绑后就不能用它登录了。`)) return;
    try {
      await api.del(`/api/auth/oauth/bindings/${provider}`);
      toast.success('已解绑');
      loadBindings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '解绑失败');
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/auth/profile', form);
      await refresh();
      toast.success('资料已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    try {
      await api.put('/api/auth/password', password);
      toast.success('密码已修改，请重新登录');
      setPassword({ old_password: '', new_password: '', new_password2: '' });
      setTimeout(() => (window.location.href = '/login'), 1200);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '修改失败');
    }
  };

  if (!user) return <Loading />;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">个人设置</h1>

      <Section title="个人资料">
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <ImageUploadField
              value={form.avatar}
              onChange={(next) => setForm({ ...form, avatar: next })}
              category="avatar"
              previewClassName="h-20 w-20"
              rounded="rounded-full"
              hint="支持 jpg / png / gif / webp / svg，建议使用 200×200 以上的正方形图片"
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <ImageUploadField
              value={form.banner}
              onChange={(next) => setForm({ ...form, banner: next })}
              category="banner"
              previewClassName="h-20 w-40"
              hint="个人主页顶部横幅，建议 1200×300"
            />
          </div>
          <Field label="昵称">
            <input
              className="input"
              value={form.display_name}
              onChange={(event) => setForm({ ...form, display_name: event.target.value })}
            />
          </Field>
          <Field label="个性签名 / 简介">
            <textarea
              className="input min-h-[90px]"
              value={form.bio}
              onChange={(event) => setForm({ ...form, bio: event.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="学校 / 单位">
              <input
                className="input"
                value={form.school}
                onChange={(event) => setForm({ ...form, school: event.target.value })}
              />
            </Field>
            <Field label="CCF 等级">
              <input
                className="input"
                value={form.ccf_level}
                onChange={(event) => setForm({ ...form, ccf_level: event.target.value })}
                placeholder="例如 CSP-S 2024 一等"
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="性别">
              <select
                className="input"
                value={form.gender}
                onChange={(event) => setForm({ ...form, gender: Number(event.target.value) })}
              >
                <option value={0}>保密</option>
                <option value={1}>男</option>
                <option value={2}>女</option>
              </select>
            </Field>
            <Field label="邮箱">
              <input
                className="input"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>
          </div>
          <Field label="默认配色">
            <select
              className="input"
              value={form.theme}
              onChange={(event) => setForm({ ...form, theme: event.target.value })}
            >
              <option value="light">浅色</option>
              <option value="dark">深色</option>
              <option value="system">跟随系统</option>
            </select>
          </Field>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={form.is_private}
                onChange={(event) => setForm({ ...form, is_private: event.target.checked })}
              />
              隐藏我的提交记录与通过题目
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={form.show_email}
                onChange={(event) => setForm({ ...form, show_email: event.target.checked })}
              />
              在个人主页显示邮箱
            </label>
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-primary" disabled={saving} onClick={save}>
              {saving ? '保存中…' : '保存资料'}
            </button>
          </div>
        </div>
      </Section>

      <Section title="修改密码">
        <div className="space-y-3 p-4">
          <Field label="原密码" required>
            <input
              className="input"
              type="password"
              value={password.old_password}
              onChange={(event) => setPassword({ ...password, old_password: event.target.value })}
            />
          </Field>
          <Field label="新密码" required hint={`至少 ${settings.password_min_length ?? 8} 位`}>
            <input
              className="input"
              type="password"
              value={password.new_password}
              onChange={(event) => setPassword({ ...password, new_password: event.target.value })}
            />
          </Field>
          <Field label="确认新密码" required>
            <input
              className="input"
              type="password"
              value={password.new_password2}
              onChange={(event) => setPassword({ ...password, new_password2: event.target.value })}
            />
          </Field>
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={changePassword}>
              修改密码
            </button>
          </div>
        </div>
      </Section>

      <Section title="账号信息">
        <dl className="space-y-2 p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">用户名</dt>
            <dd>{user.username}（注册后不可修改）</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">注册时间</dt>
            <dd>{formatTime(profile?.createdAt)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">最近登录</dt>
            <dd>{formatTime(profile?.lastLoginAt)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">当前积分</dt>
            <dd className="text-primary">{user.points}</dd>
          </div>
        </dl>
      </Section>

      {bindings && bindings.providers.length > 0 && (
        <Section title="第三方账号绑定">
          <div className="space-y-3 p-4">
            <p className="text-xs text-slate-500">
              绑定后可以直接使用第三方账号登录 OGOJ，无需输入密码。
            </p>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {bindings.providers.map((provider) => {
                const bound = bindings.bindings.find((item) => item.provider === provider.id);
                return (
                  <li key={provider.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <Link2 className="h-4 w-4 text-slate-400" />
                    <span className="flex-1">{provider.name}</span>
                    {bound ? (
                      <>
                        <span className="text-xs text-slate-400">
                          {bound.provider_username}
                          {bound.provider_email ? ` · ${bound.provider_email}` : ''}
                        </span>
                        <button
                          type="button"
                          className="text-xs text-rose-500 hover:underline"
                          onClick={() => unbind(provider.id)}
                        >
                          <Trash2 className="mr-0.5 inline h-3.5 w-3.5" />
                          解绑
                        </button>
                      </>
                    ) : (
                      <a
                        href={`/api/auth/oauth/${provider.id}/start?bind=1`}
                        className="text-xs text-primary hover:underline"
                      >
                        去绑定
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
            <OAuthButtons bind className="pt-1" />
          </div>
        </Section>
      )}

      {points && (
        <Section title="积分记录">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-32">时间</th>
                  <th>原因</th>
                  <th className="w-24">变动</th>
                  <th className="w-24">余额</th>
                </tr>
              </thead>
              <tbody>
                {points.items.slice(0, 30).map((item: any) => (
                  <tr key={item.id}>
                    <td className="text-xs text-slate-400">{formatTime(item.created_at)}</td>
                    <td className="text-sm">{item.reason}</td>
                    <td className={item.delta >= 0 ? 'text-emerald-600' : 'text-rose-500'}>
                      {item.delta >= 0 ? `+${item.delta}` : item.delta}
                    </td>
                    <td className="text-xs text-slate-500">{item.balance_after}</td>
                  </tr>
                ))}
                {points.items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-sm text-slate-400">
                      暂无积分记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <p className="text-center text-xs text-slate-400">
        头像与主页背景等文件保存在服务器的 data/uploads 目录中。
      </p>
    </div>
  );
}
