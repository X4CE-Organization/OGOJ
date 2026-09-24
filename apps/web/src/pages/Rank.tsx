import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames } from '../lib/format';
import { Avatar, EmptyState, Loading, Pagination, UserLink } from '../components/ui';

export default function Rank() {
  const { settings } = useAuth();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState(params.get('q') ?? '');

  const page = Number(params.get('page') ?? 1);
  const sort = params.get('sort') ?? 'solved';
  const size = 50;

  useEffect(() => {
    setLoading(true);
    api
      .get<any>(`/api/public/rank${query({ page, size, sort, q: params.get('q') ?? '' })}`)
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [page, size, sort, params]);

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
        <h1 className="text-lg font-semibold">排行榜</h1>
        <div className="flex items-center gap-2">
          <select className="input !w-40" value={sort} onChange={(event) => update({ sort: event.target.value })}>
            <option value="solved">按通过题数</option>
            <option value="points">按积分</option>
            {settings.show_rating !== false && <option value="rating">按等级分</option>}
            <option value="submissions">按提交数</option>
          </select>
          <input
            className="input !w-44"
            placeholder="搜索用户"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') update({ q: keyword });
            }}
          />
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title="暂无数据" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-16">排名</th>
                  <th>用户</th>
                  <th className="w-24">通过题目</th>
                  {settings.enable_points !== false && <th className="w-24">积分</th>}
                  {settings.show_rating !== false && <th className="w-24">等级分</th>}
                  <th className="w-28">提交 / 通过</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span
                        className={classNames(
                          'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                          item.rank === 1
                            ? 'bg-amber-100 text-amber-600'
                            : item.rank === 2
                              ? 'bg-slate-200 text-slate-600'
                              : item.rank === 3
                                ? 'bg-orange-100 text-orange-600'
                                : 'text-slate-400',
                        )}
                      >
                        {item.rank}
                      </span>
                    </td>
                    <td>
                      <UserLink user={item} size={28} />
                    </td>
                    <td className="font-medium">{item.solved_count}</td>
                    {settings.enable_points !== false && <td className="text-primary">{item.points}</td>}
                    {settings.show_rating !== false && <td>{item.rating}</td>}
                    <td className="text-xs text-slate-500">
                      {item.submission_count} / {item.accepted_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} size={size} total={total} onChange={(next) => update({ page: next })} />
      </div>
    </div>
  );
}
