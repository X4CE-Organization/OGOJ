import { useCallback, useEffect, useState } from 'react';
import { Heart, Search, Smile, Trash2, Upload } from 'lucide-react';
import { api, query } from '../lib/api';
import { classNames, fromNow } from '../lib/format';
import { useAuth } from '../lib/auth';
import { stickerMarkdown } from '../lib/insert';
import { EmptyState, Field, Loading, Section, UserLink } from '../components/ui';
import { useToast } from '../components/Toast';

const SCOPES = [
  { key: 'mine', label: '我的表情包', hint: '你上传的表情，公开的可以被别人收藏' },
  { key: 'favorites', label: '我的收藏', hint: '收藏别人的表情，随时取用' },
  { key: 'public', label: '公共表情包', hint: '全站公开的表情，可以收藏成自己的' },
] as const;

export default function Stickers() {
  const { user } = useAuth();
  const toast = useToast();
  const [scope, setScope] = useState<(typeof SCOPES)[number]['key']>('mine');
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ name: '', pack: '默认', isPublic: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<any>(`/api/stickers${query({ scope, q: keyword })}`);
      setItems(data.items ?? []);
      setCounts(data.counts ?? {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    if (!form.name.trim()) {
      toast.error('先给表情起个名字');
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      await api.post(
        `/api/stickers${query({ name: form.name.trim(), pack: form.pack.trim() || '默认', public: form.isPublic ? 1 : 0 })}`,
        body,
      );
      toast.success('表情已上传');
      setForm({ name: '', pack: form.pack, isPublic: form.isPublic });
      setScope('mine');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const toggleCollect = async (sticker: any) => {
    try {
      if (sticker.collected) await api.del(`/api/stickers/${sticker.id}/collect`);
      else await api.post(`/api/stickers/${sticker.id}/collect`);
      toast.success(sticker.collected ? '已取消收藏' : '已收藏');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const remove = async (sticker: any) => {
    if (!window.confirm(`删除表情「${sticker.name}」？`)) return;
    try {
      await api.del(`/api/stickers/${sticker.id}`);
      toast.success('已删除');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const copyMarkdown = async (sticker: any) => {
    try {
      await navigator.clipboard.writeText(stickerMarkdown(sticker));
      toast.success('已复制表情代码，可以粘贴到任何输入框');
    } catch {
      toast.error('复制失败');
    }
  };

  if (!user) {
    return <EmptyState title="登录后可以使用表情包" description="登录后可以上传自己的表情、收藏别人的表情" />;
  }

  const active = SCOPES.find((item) => item.key === scope)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Smile className="h-5 w-5 text-primary" /> 表情包
        </h1>
        <div className="text-xs text-slate-400">
          我的 {counts.mine ?? 0} · 收藏 {counts.favorites ?? 0} · 公共 {counts.public ?? 0}
        </div>
      </div>

      <Section
        title={
          <span className="flex items-center gap-2">
            上传新表情
            <span className="text-xs font-normal text-slate-400">支持 jpg / png / gif / webp，5 MB 以内</span>
          </span>
        }
      >
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[1fr_160px_120px_1fr]">
          <Field label="表情名称" required>
            <input
              className="input"
              value={form.name}
              placeholder="例如：点赞"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="分组">
            <input
              className="input"
              value={form.pack}
              placeholder="默认"
              onChange={(event) => setForm({ ...form, pack: event.target.value })}
            />
          </Field>
          <Field label="公开">
            <label className="flex h-9 items-center gap-2 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={form.isPublic}
                onChange={(event) => setForm({ ...form, isPublic: event.target.checked })}
              />
              让全站可用
            </label>
          </Field>
          <Field label="选择文件" required>
            <label
              className={classNames(
                'flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 transition hover:border-primary hover:text-primary dark:border-slate-600',
                uploading && 'opacity-60',
              )}
            >
              <Upload className="h-3.5 w-3.5" /> {uploading ? '上传中…' : '选择图片 / GIF'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = '';
                }}
              />
            </label>
          </Field>
        </div>
      </Section>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        {SCOPES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setScope(item.key)}
            className={classNames(
              'rounded-lg px-3 py-1.5 text-sm',
              scope === item.key ? 'bg-primary text-white' : 'border border-slate-200 text-slate-500 dark:border-slate-700',
            )}
          >
            {item.label}
            <span className="ml-1 text-xs opacity-70">{counts[item.key] ?? 0}</span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            className="input !w-full sm:!w-56 !py-1.5 pl-8 text-xs"
            placeholder="搜索名称 / 分组"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
      </div>

      <Section
        title={
          <span className="flex items-center gap-2">
            {active.label}
            <span className="text-xs font-normal text-slate-400">{active.hint}</span>
          </span>
        }
      >
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title="这里还没有表情" description={scope === 'mine' ? '用上面的表单上传一个试试' : '换个分组看看'} />
        ) : (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
            {items.map((sticker) => (
              <div
                key={sticker.id}
                className="flex flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700"
              >
                <div className="flex h-28 items-center justify-center bg-slate-50 p-2 dark:bg-slate-900">
                  <img src={sticker.url} alt={sticker.name} className="max-h-24 max-w-full object-contain" loading="lazy" />
                </div>
                <div className="flex flex-1 flex-col gap-1 p-2 text-xs">
                  <div className="flex items-center gap-1">
                    <span className="truncate font-medium">{sticker.name}</span>
                    {!sticker.isPublic && <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-400 dark:bg-slate-800">私有</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <span>{sticker.pack}</span>
                    <span>用过 {sticker.useCount} 次</span>
                  </div>
                  {!sticker.mine && (
                    <div className="flex items-center gap-1 text-[11px] text-slate-400">
                      <UserLink user={sticker.owner} size={16} />
                    </div>
                  )}
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <button type="button" className="text-primary hover:underline" onClick={() => void copyMarkdown(sticker)}>
                      复制代码
                    </button>
                    {!sticker.mine && (
                      <button
                        type="button"
                        className={classNames('inline-flex items-center gap-0.5 hover:underline', sticker.collected ? 'text-rose-500' : 'text-slate-400')}
                        onClick={() => void toggleCollect(sticker)}
                      >
                        <Heart className={classNames('h-3 w-3', sticker.collected && 'fill-rose-500')} />
                        {sticker.collected ? '已收藏' : '收藏'}
                      </button>
                    )}
                    {sticker.mine && (
                      <button type="button" className="ml-auto text-rose-500 hover:underline" onClick={() => void remove(sticker)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400">上传于 {fromNow(sticker.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
