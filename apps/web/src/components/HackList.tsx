import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crosshair, Zap } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, fromNow } from '../lib/format';
import { EmptyState, Loading, Pagination, UserLink } from './ui';
import HackDialog from './HackDialog';

export interface HackRow {
  id: number;
  verdict: string;
  message: string;
  status_before: string;
  status_after: string;
  score_delta: number;
  created_at: string;
  judged_at: string | null;
  contest_id: number | null;
  problem_id: number;
  target_submission_id: number;
  pid: string;
  problem_title: string;
  hacker_id: number;
  hacker_username: string;
  hacker_display: string | null;
  hacker_avatar: string | null;
  target_user_id: number;
  target_username: string;
  target_display: string | null;
  target_avatar: string | null;
}

const VERDICT: Record<string, { label: string; className: string }> = {
  success: { label: '成功', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  fail: { label: '失败', className: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300' },
  error: { label: '数据无效', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  pending: { label: '评测中', className: 'bg-slate-100 text-slate-500 dark:bg-slate-800' },
};

/** Shared hack table used by the contest page, the problem page and /hacks. */
export default function HackList({
  problemId,
  contestId,
  compact = false,
  showHackButton = false,
  refreshKey,
  mine = false,
}: {
  problemId?: number;
  contestId?: number;
  compact?: boolean;
  showHackButton?: boolean;
  refreshKey?: number;
  mine?: boolean;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [targets, setTargets] = useState<any[]>([]);
  const [hackTarget, setHackTarget] = useState<number | null>(null);
  const size = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(`/api/hacks${query({ problemId, contestId, page, size, mine: mine ? 'true' : '' })}`);
      setData(result);
      if (showHackButton) {
        const list = await api.get<any>(`/api/hacks/targets${query({ problemId, contestId, size: 30 })}`);
        setTargets(list.items ?? []);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [problemId, contestId, page, size, showHackButton, mine]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <div className="space-y-4">
      {showHackButton && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Crosshair className="h-4 w-4 text-primary" /> 可以 Hack 的提交
          </h3>
          {!user ? (
            <p className="text-xs text-slate-500">登录后可以 Hack 他人的提交。</p>
          ) : targets.length === 0 ? (
            <p className="text-xs text-slate-500">暂时没有可以 Hack 的提交。</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="w-20">编号</th>
                    <th>题目</th>
                    <th className="w-36">提交者</th>
                    <th className="w-24">语言</th>
                    <th className="w-24">时间</th>
                    <th className="w-28">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link to={`/record/${item.id}`} className="link font-mono text-xs">
                          #{item.id}
                        </Link>
                      </td>
                      <td className="truncate">
                        <span className="mr-1.5 font-mono text-xs text-slate-400">{item.pid}</span>
                        {item.problem_title}
                      </td>
                      <td>
                        <UserLink
                          user={{ username: item.username, display_name: item.display_name, avatar: item.avatar }}
                          size={20}
                        />
                      </td>
                      <td className="text-xs uppercase text-slate-500">{item.language}</td>
                      <td className="text-xs text-slate-400">{fromNow(item.created_at)}</td>
                      <td>
                        <button
                          type="button"
                          className="text-xs text-primary hover:underline"
                          onClick={() => setHackTarget(item.id)}
                        >
                          <Zap className="mr-0.5 inline h-3.5 w-3.5" />
                          Hack
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold">Hack 记录{data ? `（${data.total}）` : ''}</h3>
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="还没有 Hack 记录" description="发现别人代码的问题？构造数据 Hack 它！" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-16">#</th>
                  <th className="w-24">结果</th>
                  <th className="w-36">Hacker</th>
                  <th className="w-36">被 Hack</th>
                  {!compact && <th>题目</th>}
                  <th className="w-28">状态变化</th>
                  <th className="w-20">积分</th>
                  <th className="w-32">时间</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((hack: HackRow) => (
                  <tr key={hack.id}>
                    <td className="font-mono text-xs">{hack.id}</td>
                    <td>
                      <span
                        className={classNames(
                          'rounded px-1.5 py-0.5 text-xs',
                          VERDICT[hack.verdict]?.className ?? VERDICT.pending!.className,
                        )}
                        title={hack.message}
                      >
                        {VERDICT[hack.verdict]?.label ?? hack.verdict}
                      </span>
                    </td>
                    <td>
                      <UserLink
                        user={{
                          id: hack.hacker_id,
                          username: hack.hacker_username,
                          display_name: hack.hacker_display,
                          avatar: hack.hacker_avatar,
                        }}
                        size={20}
                      />
                    </td>
                    <td>
                      <UserLink
                        user={{
                          id: hack.target_user_id,
                          username: hack.target_username,
                          display_name: hack.target_display,
                          avatar: hack.target_avatar,
                        }}
                        size={20}
                      />
                    </td>
                    {!compact && (
                      <td className="truncate">
                        <Link to={`/problem/${hack.pid}`} className="hover:text-primary">
                          <span className="mr-1.5 font-mono text-xs text-slate-400">{hack.pid}</span>
                          {hack.problem_title}
                        </Link>
                      </td>
                    )}
                    <td className="text-xs">
                      {hack.status_before} → {hack.status_after}
                      <Link to={`/record/${hack.target_submission_id}`} className="ml-1 text-primary hover:underline">
                        #{hack.target_submission_id}
                      </Link>
                    </td>
                    <td className={classNames('text-xs', hack.score_delta > 0 && 'text-emerald-600')}>
                      {hack.score_delta > 0 ? `+${hack.score_delta}` : hack.score_delta || '-'}
                    </td>
                    <td className="text-xs text-slate-400">{fromNow(hack.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <Pagination page={page} size={size} total={data.total ?? 0} onChange={setPage} />
        )}
      </div>

      <HackDialog submissionId={hackTarget} open={Boolean(hackTarget)} onClose={() => setHackTarget(null)} onDone={load} />
    </div>
  );
}
