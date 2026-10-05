import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Blocks, Heart, Loader2, Plus, Search, Sparkles, Trash2, Upload } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames } from '../lib/format';
import { rememberListUrl } from '../lib/nav';
import { EmptyState, Loading, Pagination, Section, Tabs } from '../components/ui';
import { useToast } from '../components/Toast';

export interface ScratchProject {
  id: number;
  title: string;
  instructions: string;
  state: string;
  isFeatured: boolean;
  views: number;
  likeCount: number;
  liked: boolean;
  isMine: boolean;
  thumbnail: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
  author: { id: number; username: string; displayName: string; avatar?: string } | null;
}

const STATE_LABEL: Record<string, { text: string; tone: string }> = {
  draft: { text: '草稿', tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  pending: { text: '审核中', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  published: { text: '已发布', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  rejected: { text: '未通过', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
  removed: { text: '已下架', tone: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

export default function ScratchGallery() {
  const { user, settings } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [items, setItems] = useState<ScratchProject[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ enabled: boolean; canCreate: boolean; needReview: boolean; notice: string }>({
    enabled: true,
    canCreate: false,
    needReview: false,
    notice: '',
  });
  const [keyword, setKeyword] = useState(params.get('q') ?? '');

  const tab = params.get('tab') === 'mine' ? 'mine' : 'all';
  const sort = params.get('sort') ?? 'new';
  const page = Number(params.get('page') ?? 1);
  const size = Number(settings.scratch_page_size ?? 24) || 24;

  useEffect(() => {
    const search = params.toString();
    rememberListUrl('scratch', search ? `/scratch?${search}` : '/scratch');
  }, [params]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const statusData = await api.get<any>('/api/scratch/status').catch(() => null);
      if (statusData) setStatus(statusData);
      if (tab === 'mine') {
        const result = await api.get<{ items: ScratchProject[] }>('/api/scratch/mine');
        setItems(result.items ?? []);
        setTotal(result.items?.length ?? 0);
      } else {
        const result = await api.get<any>(`/api/scratch/projects${query({ page, size, sort, q: params.get('q') ?? '' })}`);
        setItems(result.items ?? []);
        setTotal(result.total ?? 0);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '作品加载失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab, page, size, sort, params, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / size)), [total, size]);

  function update(next: Record<string, string | null>) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') merged.delete(key);
      else merged.set(key, value);
    }
    setParams(merged);
  }

  async function publish(item: ScratchProject) {
    try {
      const result = await api.post<{ state: string }>(`/api/scratch/projects/${item.id}/publish`);
      toast.success(result.state === 'pending' ? '已提交审核' : '已发布到作品中心');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发布失败');
    }
  }

  async function remove(item: ScratchProject) {
    if (!window.confirm(`删除作品《${item.title}》？删除后不可恢复。`)) return;
    try {
      await api.del(`/api/scratch/projects/${item.id}`);
      toast.success('已删除');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    }
  }

  if (loading && !items.length) return <Loading />;

  if (!status.enabled) {
    return (
      <EmptyState
        title="Scratch 作品功能已关闭"
        description="管理员暂时关闭了这个功能，稍后再来看看吧。"
      />
    );
  }

  return (
    <div className="space-y-4">
      <Section
        title="Scratch 作品中心 · 用积木做作品，发布后所有人都能玩"
        action={
          status.canCreate ? (
            <Link to="/scratch/new" className="btn-primary text-xs">
              <Plus className="h-4 w-4" />
              开始创作
            </Link>
          ) : null
        }
      >
        <p className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
          用自托管的 Scratch 编辑器做作品，发布后所有人都能试玩。
        </p>
      </Section>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { key: 'all', label: '作品中心' },
            ...(user ? [{ key: 'mine', label: '我的作品' }] : []),
          ]}
          active={tab}
          onChange={(value) => update({ tab: value === 'all' ? null : value, page: null })}
        />
        {tab === 'all' ? (
          <div className="flex flex-wrap items-center gap-2 md:ml-auto">
            <select className="input !w-full sm:!w-32" value={sort} onChange={(event) => update({ sort: event.target.value, page: null })}>
              <option value="new">最新发布</option>
              <option value="hot">最多点赞</option>
              <option value="views">最多试玩</option>
            </select>
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                update({ q: keyword.trim() || null, page: null });
              }}
            >
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  className="input !w-full !pl-8 sm:!w-52"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索作品"
                />
              </div>
              <button className="btn-ghost text-xs" type="submit">
                搜索
              </button>
            </form>
          </div>
        ) : null}
      </div>

      {status.notice ? <p className="text-xs text-slate-500 dark:text-slate-400">{status.notice}</p> : null}

      {!items.length ? (
        <EmptyState
          title={tab === 'mine' ? '还没有作品' : '作品中心还是空的'}
          description={status.canCreate ? '点右上角「开始创作」，用积木做个小作品试试。' : '等管理员开放创作后再来吧。'}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <div key={item.id} className="card overflow-hidden">
              <Link to={`/scratch/${item.id}`} className="block">
                <div className="grid h-40 place-items-center overflow-hidden bg-slate-100 dark:bg-slate-800">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <Blocks className="h-9 w-9 text-slate-400" />
                  )}
                </div>
              </Link>
              <div className="space-y-1.5 p-3">
                <div className="flex items-center gap-1.5">
                  {item.isFeatured ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                      精选
                    </span>
                  ) : null}
                  {tab === 'mine' && item.state !== 'published' ? (
                    <span className={classNames('rounded px-1.5 py-0.5 text-[10px]', STATE_LABEL[item.state]?.tone ?? '')}>
                      {STATE_LABEL[item.state]?.text ?? item.state}
                    </span>
                  ) : null}
                  <Link to={`/scratch/${item.id}`} className="line-clamp-1 text-sm font-medium hover:text-[var(--ogoj-primary)]">
                    {item.title}
                  </Link>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="truncate">
                    {item.author ? (
                      <Link to={`/user/${item.author.username}`} className="hover:underline">
                        {item.author.displayName}
                      </Link>
                    ) : (
                      '未知作者'
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="flex items-center gap-0.5">
                      <Heart className="h-3 w-3" />
                      {item.likeCount}
                    </span>
                    <span>{item.views} 次试玩</span>
                  </span>
                </div>
                {tab === 'mine' ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Link to={`/scratch/new?id=${item.id}`} className="btn-ghost !px-2 !py-1 text-[11px]">
                      继续编辑
                    </Link>
                    {item.state !== 'published' ? (
                      <button className="btn-primary !px-2 !py-1 text-[11px]" onClick={() => publish(item)}>
                        <Upload className="h-3 w-3" />
                        发布
                      </button>
                    ) : (
                      <button
                        className="btn-ghost !px-2 !py-1 text-[11px]"
                        onClick={async () => {
                          await api.post(`/api/scratch/projects/${item.id}/unpublish`);
                          toast.success('已撤回为草稿');
                          await load();
                        }}
                      >
                        撤回
                      </button>
                    )}
                    <button className="btn-ghost !px-2 !py-1 text-[11px] text-rose-600" onClick={() => remove(item)}>
                      <Trash2 className="h-3 w-3" />
                      删除
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'all' && totalPages > 1 ? (
        <Pagination page={page} size={size} total={total} onChange={(value) => update({ page: String(value) })} />
      ) : null}
    </div>
  );
}
