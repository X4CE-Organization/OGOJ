import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Pencil, UserPlus } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, countdown, formatDuration, formatMs, formatTime, fromNow } from '../lib/format';
import { DifficultyBadge, EmptyState, Loading, Modal, Section, Tabs, UserLink, StatusText } from '../components/ui';
import Markdown from '../components/Markdown';
import { useToast } from '../components/Toast';
import HackList from '../components/HackList';

export default function ContestDetail() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [rank, setRank] = useState<any>(null);
  const [contestSubmissions, setContestSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(params.get('tab') ?? 'problems');
  const [passwordModal, setPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const result = await api.get<any>(`/api/contests/${id}`);
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!data) return;
    const contestId = data.contest.id;
    if (tab === 'rank') {
      api.get<any>(`/api/contests/${contestId}/ranklist`).then(setRank).catch(() => undefined);
    }
    if (tab === 'records') {
      api
        .get<any>(`/api/contests/${contestId}/submissions${query({ size: 100 })}`)
        .then((result) => setContestSubmissions(result.items))
        .catch(() => undefined);
    }
  }, [tab, data]);

  const changeTab = (next: string) => {
    setTab(next);
    const search = new URLSearchParams(params);
    search.set('tab', next);
    setParams(search, { replace: true });
  };

  const register = async (withPassword?: string) => {
    if (!user) {
      toast.error('请先登录');
      return;
    }
    try {
      await api.post(`/api/contests/${id}/register`, { password: withPassword });
      toast.success('报名成功');
      setPasswordModal(false);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '报名失败');
    }
  };

  const unregister = async () => {
    try {
      await api.post(`/api/contests/${id}/unregister`);
      toast.success('已取消报名');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  if (loading) return <Loading />;
  if (!data) return <EmptyState title="比赛不存在或未公开" />;

  const contest = data.contest;
  const canEdit = data.canEdit;

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{contest.title}</h1>
            {contest.subtitle && <p className="mt-1 text-sm text-slate-500">{contest.subtitle}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="rounded bg-primary/10 px-2 py-0.5 text-primary">
                {contest.rules.toUpperCase()} 赛制
              </span>
              <span>{formatTime(contest.startTime, false)} ~ {formatTime(contest.endTime, false)}</span>
              <span>时长 {formatDuration(contest.startTime, contest.endTime)}</span>
              <span>{contest.participantCount} 人参赛</span>
              {contest.freezeMinutes > 0 && <span>封榜 {contest.freezeMinutes} 分钟</span>}
              {contest.origin === 'user' && <span>用户自建比赛</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span
              className={classNames(
                'rounded-lg px-3 py-1 text-sm font-semibold',
                contest.status === 'running'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                  : contest.status === 'upcoming'
                    ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
                    : 'bg-slate-100 text-slate-500 dark:bg-slate-800',
              )}
              key={tick}
            >
              {contest.status === 'running'
                ? `剩余 ${countdown(contest.endTime)}`
                : contest.status === 'upcoming'
                  ? `开始于 ${countdown(contest.startTime)}`
                  : '已结束'}
            </span>
            <div className="flex items-center gap-2">
              {canEdit && (
                <Link to="/admin/contests" className="btn-ghost !px-2.5 !py-1 text-xs">
                  <Pencil className="h-3.5 w-3.5" /> 管理比赛
                </Link>
              )}
              {contest.status !== 'ended' &&
                (data.registered ? (
                  contest.status === 'upcoming' ? (
                    <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={unregister}>
                      取消报名
                    </button>
                  ) : (
                    <span className="rounded bg-emerald-50 px-2.5 py-1 text-xs text-emerald-600 dark:bg-emerald-500/10">
                      已参赛
                    </span>
                  )
                ) : (
                  <button
                    type="button"
                    className="btn-primary !py-1.5 text-xs"
                    onClick={() => (contest.hasPassword ? setPasswordModal(true) : register())}
                  >
                    <UserPlus className="h-3.5 w-3.5" /> 报名参赛
                  </button>
                ))}
            </div>
          </div>
        </div>
        {contest.description && (
          <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
            <Markdown>{contest.description}</Markdown>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <Tabs
          active={tab}
          onChange={changeTab}
          tabs={[
            { key: 'problems', label: '比赛题目', badge: data.problems.length || undefined },
            { key: 'rank', label: '排行榜' },
            { key: 'records', label: '提交记录' },
            { key: 'hack', label: 'Hack' },
          ]}
        />

        <div className="p-4">
          {tab === 'problems' && (
            <div>
              {data.problemsHidden ? (
                <EmptyState title="比赛尚未开始" description="比赛开始后即可查看题目" />
              ) : data.problems.length === 0 ? (
                <EmptyState title="本场比赛还没有题目" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th className="w-16">题号</th>
                        <th>题目名称</th>
                        <th className="w-32">难度</th>
                        <th className="w-24">分值</th>
                        <th className="w-32">我的状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.problems.map((problem: any) => (
                        <tr key={problem.id}>
                          <td className="font-semibold">{problem.label}</td>
                          <td>
                            <Link
                              to={`/problem/${problem.pid}?contestId=${contest.id}`}
                              className="hover:text-primary"
                            >
                              {problem.pid} {problem.title}
                            </Link>
                          </td>
                          <td>
                            <DifficultyBadge value={problem.difficulty} compact />
                          </td>
                          <td className="text-xs text-slate-500">{problem.contestScore}</td>
                          <td>
                            {problem.myStats?.accepted > 0 ? (
                              <StatusText status="AC" />
                            ) : problem.myStats?.attempts > 0 ? (
                              <span className="text-xs text-slate-500">尝试 {problem.myStats.attempts} 次</span>
                            ) : (
                              <span className="text-xs text-slate-400">未提交</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'rank' && (
            <div>
              {!rank ? (
                <Loading />
              ) : rank.ranklist.length === 0 ? (
                <EmptyState title={rank.message ?? '暂无排名数据'} />
              ) : (
                <>
                  {rank.message && (
                    <p className="mb-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                      {rank.message}
                      {rank.contest.frozen ? '（当前处于封榜状态）' : ''}
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="table-base text-center">
                      <thead>
                        <tr>
                          <th className="w-16">排名</th>
                          <th className="text-left">选手</th>
                          <th className="w-20">通过</th>
                          <th className="w-24">总分</th>
                          <th className="w-24">罚时</th>
                          {rank.problems.map((problem: any) => (
                            <th key={problem.id} className="w-20">
                              {problem.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rank.ranklist.map((row: any) => (
                          <tr key={row.user.id}>
                            <td className="font-semibold">{row.rank}</td>
                            <td className="text-left">
                              <UserLink user={row.user} size={22} />
                            </td>
                            <td>{row.solved}</td>
                            <td>{row.score}</td>
                            <td>{row.penalty}</td>
                            {row.cells.map((cell: any) => (
                              <td key={cell.problemId} className={classNames('text-xs')}>
                                {cell.accepted ? (
                                  <span className={classNames('font-medium', cell.firstBlood ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400')}>
                                    {cell.attempts > 0 ? `+${cell.attempts}` : '+'}
                                    {cell.score < 100 && cell.score > 0 ? ` (${cell.score})` : ''}
                                  </span>
                                ) : cell.attempts > 0 ? (
                                  <span className="text-rose-500">-{cell.attempts}</span>
                                ) : (
                                  <span className="text-slate-300">·</span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'records' && (
            <div className="overflow-x-auto">
              {contestSubmissions.length === 0 ? (
                <EmptyState title="暂无提交记录" />
              ) : (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th className="w-20">编号</th>
                      <th className="w-36">用户</th>
                      <th>题目</th>
                      <th className="w-32">结果</th>
                      <th className="w-20">时间</th>
                      <th className="w-32">提交时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contestSubmissions.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <Link to={`/record/${item.id}`} className="link font-mono text-xs">
                            #{item.id}
                          </Link>
                        </td>
                        <td>{item.username}</td>
                        <td>{item.problem_title}</td>
                        <td>
                          <StatusText status={item.status} score={item.score} />
                        </td>
                        <td className="text-xs text-slate-500">{formatMs(item.time_ms)}</td>
                        <td className="text-xs text-slate-400">{fromNow(item.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'hack' && (
            <HackList contestId={contest.id} showHackButton />
          )}
        </div>
      </div>

      <Section title="比赛提示">
        <ul className="list-disc space-y-1 px-4 py-3 pl-8 text-xs text-slate-500">
          <li>比赛期间提交的代码对其他人不可见，比赛结束后自动公开。</li>
          <li>OI 赛制在比赛进行中不公开排行榜，赛后可查看完整排名。</li>
          <li>排行榜中的红色数字代表该测试点首位通过（一血）。</li>
        </ul>
      </Section>

      <Modal
        open={passwordModal}
        title="输入比赛密码"
        onClose={() => setPasswordModal(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setPasswordModal(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={() => register(password)}>
              报名
            </button>
          </>
        }
      >
        <input
          className="input"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="请输入比赛密码"
        />
      </Modal>
    </div>
  );
}
