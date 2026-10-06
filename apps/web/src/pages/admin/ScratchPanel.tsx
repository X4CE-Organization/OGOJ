import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2, Sparkles, Star, Trash2 } from 'lucide-react';
import { api, query } from '../../lib/api';
import { classNames } from '../../lib/format';
import { EmptyState, Loading, Pagination, Section, Tabs } from '../../components/ui';
import { useToast } from '../../components/Toast';

interface Row {
  id: number;
  title: string;
  state: string;
  isFeatured: boolean;
  views: number;
  likeCount: number;
  thumbnail: string;
  createdAt: string;
  author: { username: string; displayName: string } | null;
}

const STATE_LABEL: Record<string, string> = {
  draft: '草稿',
  pending: '待审核',
  published: '已发布',
  rejected: '未通过',
  removed: '已下架',
};

export default function AdminScratch() {
  const toast = useToast();
  const [state, setState] = useState('pending');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const size = 30;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(`/api/admin/scratch/projects${query({ state, page, size })}`);
      setItems(result.items ?? []);
      setTotal(result.total ?? 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [state, page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(row: Row, body: { state?: string; featured?: boolean }, message: string) {
    setBusy(row.id);
    try {
      await api.put(`/api/admin/scratch/projects/${row.id}`, body);
      toast.success(message);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: Row) {
    if (!window.confirm(`删除作品《${row.title}》？文件和封面会一起删除。`)) return;
    setBusy(row.id);
    try {
      await api.del(`/api/admin/scratch/projects/${row.id}`);
      toast.success('已删除');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setBusy(null);
    }
  }

  if (loading && !items.length) return <Loading />;

  return (
    <div className="space-y-4">
      <Section
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Scratch 管理
          </span>
        }
        action={
          <Link to="/scratch" className="btn-ghost text-xs">
            <ExternalLink className="h-3.5 w-3.5" />
            打开作品中心
          </Link>
        }
      >
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <Tabs
            tabs={[
              { key: 'pending', label: '待审核' },
              { key: 'published', label: '已发布' },
              { key: 'draft', label: '草稿' },
              { key: 'rejected', label: '未通过' },
              { key: '', label: '全部' },
            ]}
            active={state}
            onChange={(value) => {
              setState(value);
              setPage(1);
            }}
          />
          <span className="text-xs text-slate-500 md:ml-auto">共 {total} 个作品</span>
        </div>
      </Section>

      {!items.length ? (
        <EmptyState title="没有符合筛选条件的作品" />
      ) : (
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="grid h-14 w-20 flex-none place-items-center overflow-hidden rounded border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                {row.thumbnail ? <img src={row.thumbnail} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link to={`/scratch/${row.id}`} className="line-clamp-1 text-sm font-medium hover:text-[var(--ogoj-primary)]">
                    {row.title}
                  </Link>
                  <span
                    className={classNames(
                      'rounded px-1.5 py-0.5 text-[10px]',
                      row.state === 'published'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                        : row.state === 'pending'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                    )}
                  >
                    {STATE_LABEL[row.state] ?? row.state}
                  </span>
                  {row.isFeatured ? <Star className="h-3.5 w-3.5 fill-current text-amber-500" /> : null}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {row.author ? `@${row.author.username}` : '未知作者'} · {row.views} 次试玩 · {row.likeCount} 赞 ·{' '}
                  {new Date(row.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {busy === row.id ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
                {row.state !== 'published' ? (
                  <button className="btn-primary !px-2 !py-1 text-[11px]" onClick={() => act(row, { state: 'published' }, '已通过并发布')}>
                    通过
                  </button>
                ) : null}
                {row.state !== 'rejected' ? (
                  <button className="btn-ghost !px-2 !py-1 text-[11px]" onClick={() => act(row, { state: 'rejected' }, '已标记为未通过')}>
                    打回
                  </button>
                ) : null}
                <button className="btn-ghost !px-2 !py-1 text-[11px]" onClick={() => act(row, { featured: !row.isFeatured }, row.isFeatured ? '已取消精选' : '已设为精选')}>
                  {row.isFeatured ? '取消精选' : '设为精选'}
                </button>
                <button className="btn-ghost !px-2 !py-1 text-[11px] text-rose-600" onClick={() => remove(row)}>
                  <Trash2 className="h-3 w-3" />
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={page} size={size} total={total} onChange={setPage} />
    </div>
  );
}
