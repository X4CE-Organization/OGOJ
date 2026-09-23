import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, countdown, formatDuration, formatTime } from '../lib/format';
import { EmptyState, Loading, Pagination } from '../components/ui';

const RULES_LABEL: Record<string, string> = { acm: 'ACM', oi: 'OI', ioi: 'IOI' };

export default function Contests() {
  const { user, settings, grants } = useAuth();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const page = Number(params.get('page') ?? 1);
  const status = params.get('status') ?? '';
  const rules = params.get('rules') ?? '';
  const mine = params.get('mine') ?? '';
  const size = 20;

  useEffect(() => {
    setLoading(true);
    api
      .get<any>(`/api/contests${query({ page, size, status, rules, mine })}`)
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [params.toString(), page, size, status, rules, mine]);

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
        <h1 className="text-lg font-semibold">比赛</h1>
        <div className="flex items-center gap-2">
          {user && settings.allow_user_contest !== false && (
            <span className="text-xs text-slate-500">可创建比赛资格：{grants.contest ?? 0} 次</span>
          )}
          <Link to="/shop" className="btn-primary !px-2.5 !py-1 text-xs">
            <Plus className="h-3.5 w-3.5" /> 通过商店创建比赛
          </Link>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        {[
          { value: '', label: '全部' },
          { value: 'running', label: '进行中' },
          { value: 'upcoming', label: '即将开始' },
          { value: 'ended', label: '已结束' },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => update({ status: item.value })}
            className={classNames(
              'rounded-lg px-3 py-1.5 text-sm',
              status === item.value
                ? 'bg-primary text-white'
                : 'border border-slate-200 text-slate-500 dark:border-slate-700',
            )}
          >
            {item.label}
          </button>
        ))}
        <select className="input !w-32" value={rules} onChange={(event) => update({ rules: event.target.value })}>
          <option value="">全部赛制</option>
          <option value="acm">ACM</option>
          <option value="oi">OI</option>
          <option value="ioi">IOI</option>
        </select>
        {user && (
          <label className="flex items-center gap-1.5 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={mine === 'true'}
              onChange={(event) => update({ mine: event.target.checked ? 'true' : undefined })}
            />
            我参加/创建的
          </label>
        )}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title="暂无比赛" description="可以到商店兑换资格后创建自己的比赛" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-24">状态</th>
                  <th>比赛名称</th>
                  <th className="w-20">赛制</th>
                  <th className="w-24">时长</th>
                  <th className="w-44">开始时间</th>
                  <th className="w-24">参赛人数</th>
                </tr>
              </thead>
              <tbody>
                {items.map((contest) => (
                  <tr key={contest.id}>
                    <td>
                      <span
                        className={classNames(
                          'rounded px-1.5 py-0.5 text-xs',
                          contest.status === 'running'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                            : contest.status === 'upcoming'
                              ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800',
                        )}
                      >
                        {contest.status === 'running' ? '进行中' : contest.status === 'upcoming' ? '即将开始' : '已结束'}
                      </span>
                    </td>
                    <td>
                      <Link to={`/contest/${contest.id}`} className="hover:text-primary">
                        {contest.title}
                      </Link>
                      {contest.subtitle && <div className="text-xs text-slate-400">{contest.subtitle}</div>}
                      {contest.hasPassword && <span className="ml-2 text-xs text-amber-500">🔒 需要密码</span>}
                      {contest.reviewStatus === 'pending' && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                          待审核
                        </span>
                      )}
                    </td>
                    <td className="text-xs">{RULES_LABEL[contest.rules] ?? contest.rules}</td>
                    <td className="text-xs text-slate-500">{formatDuration(contest.start_time, contest.end_time)}</td>
                    <td className="text-xs text-slate-500">
                      {formatTime(contest.start_time, false)}
                      {contest.status === 'upcoming' && (
                        <span className="ml-2 text-primary">{countdown(contest.start_time)}</span>
                      )}
                    </td>
                    <td className="text-xs text-slate-500">{contest.participant_count}</td>
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
