import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Pencil, Plus, ShoppingBag } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, countdown, formatDuration, formatTime } from '../lib/format';
import { rememberListUrl } from '../lib/nav';
import { EmptyState, Field, Loading, Modal, Pagination } from '../components/ui';
import { useToast } from '../components/Toast';

const RULES_LABEL: Record<string, string> = { acm: 'ACM', oi: 'OI', ioi: 'IOI' };

function toInput(value?: string): string {
  if (!value) return '';
  return value.includes('T') ? value.slice(0, 16) : `${value.replace(' ', 'T').slice(0, 16)}`;
}

function blankContestForm() {
  const start = new Date(Date.now() + 3600_000);
  return {
    title: '',
    subtitle: '',
    description: '',
    rules: 'acm',
    startTime: toInput(start.toISOString()),
    endTime: toInput(new Date(start.getTime() + 3 * 3600_000).toISOString()),
    freezeMinutes: 0,
    needRegister: true,
    showRank: true,
    password: '',
    rated: true,
    problemPids: '',
  };
}

export default function Contests() {
  const { user, settings, grants, refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [contestModal, setContestModal] = useState<{ isNew: boolean; id?: number } | null>(null);
  const [contestForm, setContestForm] = useState(blankContestForm);
  const [saving, setSaving] = useState(false);

  const page = Number(params.get('page') ?? 1);
  const status = params.get('status') ?? '';
  const rules = params.get('rules') ?? '';
  const mine = params.get('mine') ?? '';
  const size = 20;
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const allowUserContest = settings.allow_user_contest !== false;
  const canCreate = Boolean(user && (isAdmin || (allowUserContest && (grants.contest ?? 0) > 0)));

  // 记住列表位置，比赛详情页的「返回比赛」会回到这一屏
  useEffect(() => {
    const search = params.toString();
    rememberListUrl('contests', search ? `/contests?${search}` : '/contests');
  }, [params]);

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

  const closeContestModal = () => {
    setContestModal(null);
    const next = new URLSearchParams(params);
    next.delete('create');
    next.delete('edit');
    setParams(next, { replace: true });
  };

  const openCreate = () => {
    if (!user) {
      navigate('/login?redirect=/contests');
      return;
    }
    setContestForm(blankContestForm());
    setContestModal({ isNew: true });
  };

  const openEdit = async (id: number) => {
    try {
      const result = await api.get<any>(`/api/contests/${id}`);
      if (!result.canEdit) throw new Error('只有比赛创建者或管理员可以管理这场比赛');
      const contest = result.contest;
      setContestForm({
        title: contest.title,
        subtitle: contest.subtitle ?? '',
        description: contest.description ?? '',
        rules: contest.rules,
        startTime: toInput(contest.startTime),
        endTime: toInput(contest.endTime),
        freezeMinutes: contest.freezeMinutes ?? 0,
        needRegister: contest.needRegister,
        showRank: contest.showRank,
        password: '',
        rated: contest.rated,
        problemPids: (result.problems ?? []).map((problem: any) => problem.pid).join(' '),
      });
      setContestModal({ isNew: false, id: contest.id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '比赛加载失败');
      closeContestModal();
    }
  };

  useEffect(() => {
    if (!user) return;
    if (params.get('create') === '1') openCreate();
    const editId = Number(params.get('edit'));
    if (Number.isInteger(editId) && editId > 0) void openEdit(editId);
    // URL 只在从商店 / 比赛详情跳转时变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, user]);

  const saveContest = async () => {
    if (!contestModal) return;
    const pids = String(contestForm.problemPids ?? '')
      .split(/[\s,，]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    setSaving(true);
    try {
      const problemIds = await Promise.all(
        pids.map(async (pid) => {
          const result = await api.get<any>(`/api/problems/${encodeURIComponent(pid)}`);
          return result.problem.id;
        }),
      );
      const payload = {
        ...contestForm,
        freezeMinutes: Number(contestForm.freezeMinutes) || 0,
        startTime: contestForm.startTime ? new Date(contestForm.startTime).toISOString() : undefined,
        endTime: contestForm.endTime ? new Date(contestForm.endTime).toISOString() : undefined,
        problemIds,
      };
      if (contestModal.isNew) {
        const result = await api.post<{ id: number; reviewStatus: string }>('/api/contests', payload);
        toast.success(result.reviewStatus === 'pending' ? '比赛已创建，等待管理员审核' : '比赛已创建');
        await refresh();
        closeContestModal();
        navigate(`/contest/${result.id}`);
      } else {
        await api.put(`/api/contests/${contestModal.id}`, payload);
        toast.success('比赛已保存');
        closeContestModal();
        navigate(`/contest/${contestModal.id}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">比赛</h1>
        <div className="flex items-center gap-2">
          {user && settings.allow_user_contest !== false && (
            <span className="text-xs text-slate-500">可创建比赛资格：{grants.contest ?? 0} 次</span>
          )}
          {canCreate ? (
            <button type="button" className="btn-primary !px-2.5 !py-1 text-xs" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> 创建比赛
            </button>
          ) : user && allowUserContest ? (
            <Link to="/shop" className="btn-primary !px-2.5 !py-1 text-xs">
              <ShoppingBag className="h-3.5 w-3.5" /> 获取比赛资格
            </Link>
          ) : !user ? (
            <Link to="/login?redirect=/contests" className="btn-primary !px-2.5 !py-1 text-xs">
              <Plus className="h-3.5 w-3.5" /> 登录后创建比赛
            </Link>
          ) : null}
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
        <select className="input !w-full sm:!w-32" value={rules} onChange={(event) => update({ rules: event.target.value })}>
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
          <EmptyState
            title="暂无比赛"
            description={canCreate ? '点击右上角「创建比赛」开始组织自己的比赛' : '可以到商店兑换资格后创建自己的比赛'}
          />
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

      <Modal
        open={Boolean(contestModal)}
        title={contestModal?.isNew ? '创建比赛' : '管理比赛'}
        onClose={closeContestModal}
        width="max-w-3xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-ghost text-sm" onClick={closeContestModal}>
              取消
            </button>
            <button type="button" className="btn-primary text-sm" disabled={saving} onClick={saveContest}>
              {saving ? '保存中…' : contestModal?.isNew ? '提交比赛' : '保存修改'}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {contestModal?.isNew && !isAdmin && settings.user_contest_need_review !== false ? (
            <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              提交后需要管理员审核；审核通过后会公开并开放报名。
            </p>
          ) : null}
          <Field label="比赛名称" required>
            <input
              className="input"
              value={contestForm.title}
              onChange={(event) => setContestForm({ ...contestForm, title: event.target.value })}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="副标题">
              <input
                className="input"
                value={contestForm.subtitle}
                onChange={(event) => setContestForm({ ...contestForm, subtitle: event.target.value })}
              />
            </Field>
            <Field label="赛制">
              <select
                className="input"
                value={contestForm.rules}
                onChange={(event) => setContestForm({ ...contestForm, rules: event.target.value })}
              >
                <option value="acm">ACM</option>
                <option value="oi">OI</option>
                <option value="ioi">IOI</option>
              </select>
            </Field>
            <Field label="开始时间" required>
              <input
                className="input"
                type="datetime-local"
                value={contestForm.startTime}
                onChange={(event) => setContestForm({ ...contestForm, startTime: event.target.value })}
              />
            </Field>
            <Field
              label="结束时间"
              required
              hint={!isAdmin ? `普通用户单次最长 ${settings.user_contest_max_days ?? 7} 天` : undefined}
            >
              <input
                className="input"
                type="datetime-local"
                value={contestForm.endTime}
                onChange={(event) => setContestForm({ ...contestForm, endTime: event.target.value })}
              />
            </Field>
          </div>
          <Field label="比赛题目" hint="填写公开题号，用空格分隔，例如 P1001 P1002；也可以稍后管理时再添加">
            <input
              className="input"
              value={contestForm.problemPids}
              onChange={(event) => setContestForm({ ...contestForm, problemPids: event.target.value })}
            />
          </Field>
          <Field label="比赛说明（Markdown）">
            <textarea
              className="input min-h-[130px] font-mono text-xs"
              value={contestForm.description}
              onChange={(event) => setContestForm({ ...contestForm, description: event.target.value })}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="比赛密码" hint="留空表示无需密码">
              <input
                className="input"
                value={contestForm.password}
                onChange={(event) => setContestForm({ ...contestForm, password: event.target.value })}
              />
            </Field>
            <Field label="封榜时长（分钟）">
              <input
                className="input"
                type="number"
                min={0}
                value={contestForm.freezeMinutes}
                onChange={(event) => setContestForm({ ...contestForm, freezeMinutes: Number(event.target.value) })}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-300">
            {[
              ['needRegister', '需要报名'],
              ['showRank', '公开排行榜'],
              ['rated', '计入积分结算'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={Boolean(contestForm[key as keyof typeof contestForm])}
                  onChange={(event) =>
                    setContestForm((current) => ({ ...current, [key]: event.target.checked }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
