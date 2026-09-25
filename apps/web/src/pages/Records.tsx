import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LANGUAGE_NAMES, formatMemory, formatMs, fromNow } from '../lib/format';
import { rememberListUrl } from '../lib/nav';
import { EmptyState, Loading, Pagination, StatusText, UserLink } from '../components/ui';

export default function Records() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const page = Number(params.get('page') ?? 1);
  const size = 50;
  const status = params.get('status') ?? '';
  const language = params.get('language') ?? '';
  const keyword = params.get('q') ?? '';
  const mine = params.get('mine') ?? '';
  const contest = params.get('contest') ?? '';

  // 记住列表位置，评测详情页的「返回评测记录」会回到这一屏
  useEffect(() => {
    const search = params.toString();
    rememberListUrl('records', search ? `/record?${search}` : '/record');
  }, [params]);

  const load = () => {
    setLoading(true);
    api
      .get<any>(`/api/submissions${query({ page, size, status, language, q: keyword, mine, contest })}`)
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(load, [params.toString()]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, params.toString()]);

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
        <h1 className="text-lg font-semibold">评测记录</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            自动刷新
          </label>
          <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" /> 刷新
          </button>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <select className="input !w-36" value={status} onChange={(event) => update({ status: event.target.value })}>
          <option value="">全部结果</option>
          {['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'OLE', 'PE', 'Waiting', 'Judging'].map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select className="input !w-44" value={language} onChange={(event) => update({ language: event.target.value })}>
          <option value="">全部语言</option>
          {Object.entries(LANGUAGE_NAMES).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <input
          className="input !w-56"
          placeholder="题目名称 / 编号"
          defaultValue={keyword}
          onKeyDown={(event) => {
            if (event.key === 'Enter') update({ q: (event.target as HTMLInputElement).value });
          }}
        />
        {user && (
          <label className="flex items-center gap-1.5 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={mine === 'true'}
              onChange={(event) => update({ mine: event.target.checked ? 'true' : undefined })}
            />
            只看我的
          </label>
        )}
        {contest && (
          <span className="rounded bg-primary/10 px-2 py-1 text-xs text-primary">
            仅显示比赛 #{contest}
            <button type="button" className="ml-2" onClick={() => update({ contest: undefined })}>
              ✕
            </button>
          </span>
        )}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title="暂无评测记录" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-20">编号</th>
                  <th className="w-40">用户</th>
                  <th>题目</th>
                  <th className="w-40">结果</th>
                  <th className="w-24">语言</th>
                  <th className="w-24">时间</th>
                  <th className="w-24">内存</th>
                  <th className="w-32">提交时间</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link to={`/record/${item.id}`} className="link font-mono text-xs">
                        #{item.id}
                      </Link>
                    </td>
                    <td>
                      <UserLink user={item.user} size={22} />
                    </td>
                    <td>
                      <Link to={`/problem/${item.problemPid}`} className="hover:text-primary">
                        <span className="mr-1.5 font-mono text-xs text-slate-400">{item.problemPid}</span>
                        {item.problemTitle}
                      </Link>
                      {item.contestId && (
                        <Link to={`/contest/${item.contestId}`} className="ml-2 text-xs text-primary">
                          [比赛]
                        </Link>
                      )}
                    </td>
                    <td>
                      <StatusText status={item.status} score={item.score} />
                    </td>
                    <td className="text-xs text-slate-500">{LANGUAGE_NAMES[item.language] ?? item.language}</td>
                    <td className="text-xs text-slate-500">{formatMs(item.timeMs)}</td>
                    <td className="text-xs text-slate-500">{formatMemory(item.memoryKb)}</td>
                    <td className="text-xs text-slate-400">{fromNow(item.createdAt)}</td>
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
