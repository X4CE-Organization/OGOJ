import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PenLine, Eye } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fromNow } from '../lib/format';
import { Avatar, EmptyState, Loading, Pagination } from '../components/ui';

export default function Articles() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const page = Number(params.get('page') ?? 1);
  const category = params.get('category') ?? '';
  const keyword = params.get('q') ?? '';
  const size = 20;

  useEffect(() => {
    setLoading(true);
    api
      .get<any>(`/api/articles${query({ page, size, category, q: keyword })}`)
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [page, size, category, keyword]);

  const update = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">专栏</h1>
        {user && (
          <Link to="/article/new" className="btn-primary !px-3 !py-1.5 text-sm">
            <PenLine className="h-4 w-4" /> 写文章
          </Link>
        )}
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        {['全部', '学习', '教程', '题解', '生活', '其他'].map((item, index) => (
          <button
            key={item}
            type="button"
            onClick={() => update({ category: index === 0 ? undefined : item })}
            className={
              (index === 0 ? !category : category === item)
                ? 'rounded-lg bg-primary px-3 py-1.5 text-sm text-white'
                : 'rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-500 dark:border-slate-700'
            }
          >
            {item}
          </button>
        ))}
        <input
          className="input ml-auto !w-48"
          placeholder="搜索文章"
          defaultValue={keyword}
          onKeyDown={(event) => {
            if (event.key === 'Enter') update({ q: (event.target as HTMLInputElement).value });
          }}
        />
      </div>

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState title="还没有文章" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((article) => (
            <Link key={article.id} to={`/article/${article.id}`} className="card flex gap-3 p-4 hover:shadow-md">
              {article.cover ? (
                <img src={article.cover} alt={article.title} className="h-20 w-28 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-2xl text-primary">
                  {article.category.slice(0, 1)}
                </div>
              )}
              <div className="min-w-0">
                <h2 className="truncate font-semibold">
                  {article.is_pinned ? <span className="mr-1 text-rose-500">[置顶]</span> : null}
                  {article.title}
                </h2>
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">{article.summary}</p>
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                  <Avatar user={article.author} size={18} />
                  <span>{article.display_name || article.username}</span>
                  <span className="ml-auto flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {article.views}
                  </span>
                  <span>{fromNow(article.created_at)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="card">
        <Pagination page={page} size={size} total={total} onChange={(next) => update({ page: next })} />
      </div>
    </div>
  );
}
