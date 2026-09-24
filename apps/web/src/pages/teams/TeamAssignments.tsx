import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { classNames, formatTime, fromNow } from '../../lib/format';
import {
  Avatar,
  DifficultyBadge,
  EmptyState,
  Field,
  Loading,
  Modal,
  Section,
  StatusText,
  UserLink,
} from '../../components/ui';
import { useToast } from '../../components/Toast';
import type { TeamContextValue } from './TeamLayout';

export default function TeamAssignments() {
  const ctx = useOutletContext<TeamContextValue>();
  const { id } = useParams();
  if (id) return <AssignmentDetail teamSlug={ctx.team.slug} id={id} ctx={ctx} />;
  return <AssignmentList ctx={ctx} />;
}

function toInput(value?: string | null) {
  if (!value) return '';
  return value.includes('T') ? value.slice(0, 16) : `${value.replace(' ', 'T').slice(0, 16)}`;
}

function AssignmentList({ ctx }: { ctx: TeamContextValue }) {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    startTime: '',
    endTime: '',
    targetGroupId: '',
    problemIds: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<any>(`/api/teams/${ctx.team.slug}/assignments`));
      setGroups((await api.get<any>(`/api/teams/${ctx.team.slug}/groups`)).items ?? []);
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
      const result = await api.post<{ id: number }>(`/api/teams/${ctx.team.slug}/assignments`, {
        ...form,
        problemIds: problemIds.length ? problemIds : undefined,
      });
      toast.success('作业已发布');
      setCreating(false);
      setForm({ title: '', description: '', startTime: '', endTime: '', targetGroupId: '', problemIds: '' });
      window.location.href = `/team/${ctx.team.slug}/assignments/${result.id}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发布失败（请在题目列表里先确认题目 ID）');
    }
  };

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <span className="text-sm text-slate-500">共 {data?.items?.length ?? 0} 份作业</span>
        {data?.canManage && (
          <button type="button" className="btn-primary ml-auto !py-1.5 text-xs" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> 发布作业
          </button>
        )}
      </div>

      {loading ? (
        <Loading />
      ) : !data?.items?.length ? (
        <div className="card">
          <EmptyState title="还没有作业" description="发布一份作业，把题目打包给队友练习" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.items.map((assignment: any) => {
            const total = assignment.problemIds.length || 1;
            const percent = Math.round((assignment.mySolved / total) * 100);
            return (
              <Link
                key={assignment.id}
                to={`/team/${ctx.team.slug}/assignments/${assignment.id}`}
                className="card p-4 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{assignment.title}</h2>
                  {assignment.group_name && (
                    <span
                      className="rounded px-1.5 py-0.5 text-[11px]"
                      style={{ backgroundColor: `${assignment.group_color}22`, color: assignment.group_color }}
                    >
                      {assignment.group_name}
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">{assignment.description || '暂无说明'}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="h-3 w-3" />
                    {assignment.start_time ? formatTime(assignment.start_time, false) : '不限开始'}
                    {' ~ '}
                    {assignment.end_time ? formatTime(assignment.end_time, false) : '不限截止'}
                  </span>
                  <span>{assignment.problem_count} 题</span>
                  <span>发布者 {assignment.creator_name ?? '管理员'}</span>
                </div>
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                    <span>我的完成度</span>
                    <span>
                      {assignment.mySolved} / {assignment.problemIds.length}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={classNames('h-full rounded-full', percent === 100 ? 'bg-emerald-500' : 'bg-primary')}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Modal
        open={creating}
        title="发布作业"
        onClose={() => setCreating(false)}
        width="max-w-2xl"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={create}>
              发布作业
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="作业标题" required>
            <input
              className="input"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="例如：第一周训练：基础数据结构"
            />
          </Field>
          <Field label="作业说明">
            <textarea
              className="input min-h-[100px]"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="开始时间">
              <input
                className="input"
                type="datetime-local"
                value={form.startTime}
                onChange={(event) => setForm({ ...form, startTime: event.target.value })}
              />
            </Field>
            <Field label="截止时间">
              <input
                className="input"
                type="datetime-local"
                value={form.endTime}
                onChange={(event) => setForm({ ...form, endTime: event.target.value })}
              />
            </Field>
          </div>
          <Field label="面向组别" hint="不选表示面向全体成员">
            <select
              className="input"
              value={form.targetGroupId}
              onChange={(event) => setForm({ ...form, targetGroupId: event.target.value })}
            >
              <option value="">全体成员</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}（{group.member_count} 人）
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="题目 ID"
            required
            hint="用空格或逗号分隔的题目 ID；可以先去「题目」标签页添加题目，再从那里复制 ID"
          >
            <input
              className="input"
              value={form.problemIds}
              onChange={(event) => setForm({ ...form, problemIds: event.target.value })}
              placeholder="1 2 3"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function AssignmentDetail({ teamSlug, id, ctx }: { teamSlug: string; id: string; ctx: TeamContextValue }) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await api.get<any>(`/api/teams/${teamSlug}/assignments/${id}`));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [teamSlug, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    if (!window.confirm('确定删除这份作业吗？')) return;
    await api.del(`/api/teams/${teamSlug}/assignments/${id}`);
    toast.success('已删除');
    navigate(`/team/${teamSlug}/assignments`);
  };

  if (loading) return <Loading />;
  if (!data) return <EmptyState title="作业不存在" />;

  const { assignment, problems, members } = data;
  const done = problems.filter((problem: any) => problem.mySolved).length;

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">{assignment.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span>
                时间：
                {assignment.start_time ? formatTime(assignment.start_time, false) : '不限'}
                {' ~ '}
                {assignment.end_time ? formatTime(assignment.end_time, false) : '不限'}
              </span>
              <span>发布者 {assignment.creator_name ?? '管理员'}</span>
              {assignment.group_name && <span>面向 {assignment.group_name}</span>}
              <span>
                我的完成度 {done} / {problems.length}
              </span>
            </div>
          </div>
          {data.canManage && (
            <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs text-rose-500" onClick={remove}>
              <Trash2 className="h-3.5 w-3.5" /> 删除作业
            </button>
          )}
        </div>
        {assignment.description && (
          <p className="mt-3 whitespace-pre-wrap border-t border-slate-100 pt-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
            {assignment.description}
          </p>
        )}
      </div>

      <Section title={`作业题目（${problems.length}）`}>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-12">#</th>
                <th className="w-24">编号</th>
                <th>题目</th>
                <th className="w-28">难度</th>
                <th className="w-32">我的状态</th>
                <th className="w-24">分值</th>
              </tr>
            </thead>
            <tbody>
              {problems.map((problem: any, index: number) => (
                <tr key={problem.id}>
                  <td className="text-xs text-slate-400">{index + 1}</td>
                  <td className="font-mono text-xs text-slate-400">{problem.pid}</td>
                  <td>
                    <Link to={`/problem/${problem.pid}`} className="hover:text-primary">
                      {problem.title}
                    </Link>
                  </td>
                  <td>
                    <DifficultyBadge value={problem.difficulty} compact />
                  </td>
                  <td>
                    {problem.mySolved ? (
                      <StatusText status="AC" />
                    ) : problem.my_last_status ? (
                      <StatusText status={problem.my_last_status} />
                    ) : (
                      <span className="text-xs text-slate-400">未提交</span>
                    )}
                  </td>
                  <td className="text-xs text-slate-500">{problem.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={`成员完成情况（${members.length}）`}>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-16">排名</th>
                <th>成员</th>
                <th className="w-28">完成题数</th>
                <th className="w-28">贡献度</th>
                <th>进度</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member: any, index: number) => {
                const percent = Math.round((member.solved / Math.max(1, problems.length)) * 100);
                return (
                  <tr key={member.id} className={classNames(member.id === user?.id && 'bg-primary/[0.04]')}>
                    <td className="text-xs text-slate-400">{index + 1}</td>
                    <td>
                      <UserLink user={member} size={22} />
                    </td>
                    <td className="text-sm">
                      {member.solved} / {problems.length}
                    </td>
                    <td className="text-xs text-slate-500">{member.contribution}</td>
                    <td>
                      <div className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className={classNames('h-full rounded-full', percent === 100 ? 'bg-emerald-500' : 'bg-primary')}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <p className="text-center text-xs text-slate-400">
        完成情况按作业时间区间内、你在这些题目上的首个 Accepted 判定；由 {ctx.team.name} 管理。
      </p>
    </div>
  );
}
