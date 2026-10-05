import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ImagePlus, Loader2, Radio, Search, Send, X } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames } from '../lib/format';
import { rememberListUrl } from '../lib/nav';
import { EmptyState, Loading, Pagination, Section, Tabs } from '../components/ui';
import MomentCard, { type MomentItem } from '../components/MomentCard';
import StickerPicker from '../components/StickerPicker';
import { insertAtCursor } from '../lib/insert';
import { useToast } from '../components/Toast';

export default function Moments() {
  const { user, settings } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<MomentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [keyword, setKeyword] = useState(params.get('q') ?? '');
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const title = String(settings.moment_site_title ?? '动态') || '动态';
  const placeholder = String(settings.moment_publish_hint ?? '') || '写点什么，记录你的刷题日常…';
  const emptyHint = String(settings.moment_empty_hint ?? '') || '还没有人发动态，来发第一条吧';
  const maxImages = Number(settings.moment_max_images ?? 9) || 0;
  const maxLength = Number(settings.moment_max_length ?? 2000) || 2000;
  const size = Number(settings.moment_page_size ?? 20) || 20;

  const page = Number(params.get('page') ?? 1);
  const scope = params.get('scope') ?? 'all';
  const search = params.get('q') ?? '';
  const userFilter = params.get('user') ?? '';

  useEffect(() => {
    const search2 = params.toString();
    rememberListUrl('moments', search2 ? `/moments?${search2}` : '/moments');
  }, [params]);

  useEffect(() => {
    setLoading(true);
    api
      .get<any>(`/api/moments${query({ page, size, scope, q: search, user: userFilter })}`)
      .then((data) => {
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
        setEnabled(data.enabled !== false);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [page, size, scope, search, userFilter]);

  const update = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  const upload = async (file: File) => {
    if (maxImages <= 0) {
      toast.error('本站已关闭动态配图');
      return;
    }
    if (images.length >= maxImages) {
      toast.error(`最多上传 ${maxImages} 张图片`);
      return;
    }
    setUploading(true);
    try {
      const result = await api.upload<{ url: string }>('/api/upload?category=moment', file);
      setImages((current) => [...current, result.url].slice(0, maxImages));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const publish = async () => {
    const content = draft.trim();
    if (!content && !images.length) {
      toast.error('写点内容或者配张图吧');
      return;
    }
    setPublishing(true);
    try {
      await api.post('/api/moments', { content, images });
      setDraft('');
      setImages([]);
      toast.success('发布成功');
      if (page === 1) {
        const data = await api.get<any>(`/api/moments${query({ page: 1, size, scope, q: search, user: userFilter })}`);
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
      } else {
        update({ page: 1 });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  if (!enabled) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">{title}</h1>
        <Section>
          <EmptyState title="动态功能已关闭" description="管理员可以在控制面板 → 系统设置 → 动态 中重新开启。" />
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Radio className="h-5 w-5 text-primary" />
          {userFilter ? `${userFilter} 的动态` : title}
        </h1>
        <form
          className="relative"
          onSubmit={(event) => {
            event.preventDefault();
            update({ q: keyword.trim() || undefined });
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索动态内容"
            className="input !w-full sm:!w-56 !pl-8"
          />
        </form>
      </div>

      {/* ---------------------------------------------------------- 发布框 */}
      {user ? (
        <Section>
          <div className="space-y-2 p-4">
            <textarea
              ref={contentRef}
              className="input min-h-[92px] resize-y"
              value={draft}
              maxLength={maxLength}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={placeholder}
            />
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {images.map((url) => (
                  <div key={url} className="relative">
                    <img
                      src={url}
                      alt="待发布图片"
                      className="h-20 w-20 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                    />
                    <button
                      type="button"
                      onClick={() => setImages((current) => current.filter((item) => item !== url))}
                      className="absolute -right-1.5 -top-1.5 rounded-full bg-slate-900/70 p-0.5 text-white transition hover:bg-rose-500"
                      title="移除图片"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <button
                type="button"
                className="btn-ghost !px-2.5"
                disabled={uploading || maxImages <= 0}
                onClick={() => fileRef.current?.click()}
                title={maxImages > 0 ? `最多 ${maxImages} 张图片` : '已关闭配图'}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                图片
              </button>
              <StickerPicker onPick={(markdown) => insertAtCursor(contentRef.current, markdown, setDraft)} />
              <span className="ml-auto text-xs text-slate-400">
                {draft.length} / {maxLength}
              </span>
              <button
                type="button"
                className={classNames('btn-primary !px-3')}
                disabled={publishing || (!draft.trim() && !images.length)}
                onClick={publish}
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                发布
              </button>
            </div>
          </div>
        </Section>
      ) : (
        <Section>
          <p className="px-4 py-3 text-sm text-slate-500">
            <Link to="/login" className="text-primary hover:underline">
              登录
            </Link>
            后可以发布动态、点赞和评论。
          </p>
        </Section>
      )}

      {/* ------------------------------------------------------------ 筛选 */}
      <Tabs
        active={scope}
        onChange={(key) => update({ scope: key })}
        tabs={[
          { key: 'all', label: '全站' },
          { key: 'following', label: '关注' },
          { key: 'mine', label: '我的' },
          { key: 'liked', label: '我赞过的' },
        ]}
      />

      {loading ? (
        <Loading />
      ) : !user && scope !== 'all' ? (
        <Section>
          <EmptyState
            title="登录后才能查看这个列表"
            description="「关注」「我的」「我赞过的」都需要先登录。"
            action={
              <Link to="/login" className="btn-primary mt-1">
                去登录
              </Link>
            }
          />
        </Section>
      ) : items.length === 0 ? (
        <Section>
          <EmptyState title={search ? '没有找到相关动态' : emptyHint} />
        </Section>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <MomentCard
              key={item.id}
              moment={item}
              onUpdate={(patch) =>
                setItems((current) => current.map((row) => (row.id === item.id ? { ...row, ...patch } : row)))
              }
              onDelete={() => {
                setItems((current) => current.filter((row) => row.id !== item.id));
                setTotal((current) => Math.max(0, current - 1));
              }}
            />
          ))}
        </div>
      )}

      <Pagination page={page} size={size} total={total} onChange={(next) => update({ page: next })} />
    </div>
  );
}
