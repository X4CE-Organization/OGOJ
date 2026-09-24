import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { classNames, countdown, formatDuration, formatTime } from '../../lib/format';
import { EmptyState, Field, Loading, Modal } from '../../components/ui';
import { useToast } from '../../components/Toast';
import type { TeamContextValue } from './TeamLayout';

const RULES_LABEL: Record<string, string> = { acm: 'ACM', oi: 'OI', ioi: 'IOI' };

function statusOf(start: string, end: string) {
  const now = Date.now();
  const parse = (value: string) => new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).getTime();
  if (now < parse(start)) return 'upcoming';
  if (now > parse(end)) return 'ended';
  return 'running';
}

export default function TeamContests() {
  const ctx = useOutletContext<TeamContextValue>();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    title: '',
    subtitle: '',
    description: '',
    rules: 'acm',
    startTime: '',
    endTime: '',
    problemIds: '',
    isPublic: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<any>(`/api/teams/${ctx.team.slug}/contests`));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ctx.team.slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    try {
      const problemIds = form.problemIds
        .split(/[\s,，]+/)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
      const result = await api.post<{ id: number }>(`/api/teams/${ctx.team.slug}/contests`, {
        ...form,
        startTime: form.startTime ? new Date(form.startTime).toISOString() : undefined,
        endTime: form.endTime ? new Date(form.endTime).toISOString() : undefined,
        problemIds,
      });
      toast.success('团队比赛已创建，成员已自动报名');
      setCreating(false);
      window.location.href = `/contest/${result.id}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    }
  };

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <span className="text-sm text-slate-500">
          共 {data?.items?.length ?? 0} 场比赛 · 团队成员会自动报名，排行榜沿用比赛本身的榜单
        </span>
        {data?.canManage && (
          <button type="button" className="btn-primary ml-auto !py-1.5 text-xs" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> 创建团队比赛
          </button>
        )}
      </div>

      {loading ? (
        <Loading />
      ) : !data?.items?.length ? (
        <div className="card">
          <EmptyState title="还没有团队比赛" description="建一场队内赛，和队友一较高下" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-24">状态</th>
                <th>比赛名称</th>
                <th className="w-20">赛制</th>
                <th className="w-24">题目</th>
                <th className="w-40">时间</th>
                <th className="w-24">参赛</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((contest: any) => {
                const status = statusOf(contest.start_time, contest.end_time);
                return (
                  <tr key={contest.id}>
                    <td>
                      <span
                        className={classNames(
                          'rounded px-1.5 py-0.5 text-xs',
                          status === 'running'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                            : status === 'upcoming'
                              ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800',
                        )}
                      >
                        {status === 'running' ? '进行中' : status === 'upcoming' ? '即将开始' : '已结束'}
                      </span>
                    </td>
                    <td>
                      <Link to={`/contest/${contest.id}`} className="hover:text-primary">
                        {contest.title}
                      </Link>
                      {!contest.is_public && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 text-[11px] text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                          仅团队
                        </span>
                      )}
                      {contest.subtitle && <div className="text-xs text-slate-400">{contest.subtitle}</div>}
                    </td>
                    <td className="text-xs">{RULES_LABEL[contest.rules] ?? contest.rules}</td>
                    <td className="text-xs text-slate-500">{contest.problem_count}</td>
                    <td className="text-xs text-slate-500">
                      {formatTime(contest.start_time, false)}
                      <div className="text-slate-400">
                        {status === 'upcoming' ? countdown(contest.start_time) : formatDuration(contest.start_time, contest.end_time)}
                      </div>
                    </td>
                    <td className="text-xs text-slate-500">{contest.participant_count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={creating}
        title="创建团队比赛"
        onClose={() => setCreating(false)}
        width="max-w-2xl"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={create}>
              创建比赛
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="比赛名称" required>
            <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </Field>
          <Field label="副标题">
            <input className="input" value={form.subtitle} onChange={(event) => setForm({ ...form, subtitle: event.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="赛制">
              <select className="input" value={form.rules} onChange={(event) => setForm({ ...form, rules: event.target.value })}>
                <option value="acm">ACM</option>
                <option value="oi">OI</option>
                <option value="ioi">IOI</option>
              </select>
            </Field>
            <Field label="开始时间" required>
              <input
                className="input"
                type="datetime-local"
                value={form.startTime}
                onChange={(event) => setForm({ ...form, startTime: event.target.value })}
              />
            </Field>
            <Field label="结束时间" required>
              <input
                className="input"
                type="datetime-local"
                value={form.endTime}
                onChange={(event) => setForm({ ...form, endTime: event.target.value })}
              />
            </Field>
          </div>
          <Field label="题目 ID" hint="空格分隔，按顺序编号为 A、B、C…">
            <input
              className="input"
              value={form.problemIds}
              onChange={(event) => setForm({ ...form, problemIds: event.target.value })}
              placeholder="1 2 3"
            />
          </Field>
          <Field label="比赛说明">
            <textarea
              className="input min-h-[100px]"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(event) => setForm({ ...form, isPublic: event.target.checked })}
            />
            同时对外公开（不勾选则只有团队成员能看到）
          </label>
        </div>
      </Modal>
    </div>
  );
}
