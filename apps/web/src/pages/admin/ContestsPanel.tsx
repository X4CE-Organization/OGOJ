import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Pencil, Plus, Trash2, Trophy, X } from 'lucide-react';
import { api, query } from '../../lib/api';
import { classNames, formatTime } from '../../lib/format';
import { EmptyState, Field, Loading, Modal, Pagination } from '../../components/ui';
import { useToast } from '../../components/Toast';

function toInput(value?: string) {
  if (!value) return '';
  return value.includes('T') ? value.slice(0, 16) : `${value.replace(' ', 'T').slice(0, 16)}`;
}

export default function ContestsPanel() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [review, setReview] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(`/api/contests${query({ page, size: 30, all: 'true', review })}`);
      setData(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, review]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (contest?: any) => {
    if (!contest) {
      const start = new Date(Date.now() + 3600_000);
      setForm({
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
        isPublic: true,
        problemIds: '',
      });
      setEditing({ isNew: true });
      return;
    }
    api
      .get<any>(`/api/contests/${contest.id}`)
      .then((result) => {
        setForm({
          title: result.contest.title,
          subtitle: result.contest.subtitle ?? '',
          description: result.contest.description ?? '',
          rules: result.contest.rules,
          startTime: toInput(result.contest.startTime),
          endTime: toInput(result.contest.endTime),
          freezeMinutes: result.contest.freezeMinutes,
          needRegister: result.contest.needRegister,
          showRank: result.contest.showRank,
          password: '',
          rated: result.contest.rated,
          isPublic: true,
          problemIds: (result.problems ?? [])
            .map((problem: any) => problem.id)
            .join(' '),
        });
        setEditing(contest);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : '加载失败'));
  };

  const save = async () => {
    const payload = {
      ...form,
      freezeMinutes: Number(form.freezeMinutes) || 0,
      startTime: form.startTime ? new Date(form.startTime).toISOString() : undefined,
      endTime: form.endTime ? new Date(form.endTime).toISOString() : undefined,
      problemIds: String(form.problemIds ?? '')
        .split(/[\s,，]+/)
        .map(Number)
        .filter((value) => Number.isInteger(value) && value > 0),
    };
    try {
      if (editing?.isNew) {
        await api.post('/api/contests', payload);
        toast.success('比赛已创建');
      } else {
        await api.put(`/api/contests/${editing.id}`, payload);
        toast.success('比赛已保存');
      }
      setEditing(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const reviewContest = async (contest: any, approve: boolean) => {
    const note = approve ? '' : window.prompt('驳回原因', '比赛信息需要修改') ?? '';
    try {
      await api.post(`/api/admin/contests/${contest.id}/review`, { approve, note });
      toast.success(approve ? '已通过审核' : '已驳回');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const finalize = async (contest: any) => {
    if (!window.confirm('比赛结束后结算积分并发放奖励？')) return;
    try {
      const result = await api.post<{ awarded: number }>(`/api/contests/${contest.id}/finalize`);
      toast.success(`结算完成，${result.awarded} 名选手获得积分`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '结算失败');
    }
  };

  const remove = async (contest: any) => {
    if (!window.confirm(`确定删除比赛「${contest.title}」吗？`)) return;
    try {
      await api.del(`/api/contests/${contest.id}`);
      toast.success('已删除');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">比赛管理</h1>
        <button type="button" className="btn-primary !py-1.5 text-xs" onClick={() => openEditor()}>
          <Plus className="h-3.5 w-3.5" /> 新建比赛
        </button>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        {[
          { value: '', label: '全部' },
          { value: 'pending', label: '待审核' },
          { value: 'approved', label: '已通过' },
          { value: 'rejected', label: '已驳回' },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              setReview(item.value);
              setPage(1);
            }}
            className={classNames(
              'rounded-lg px-3 py-1.5 text-sm',
              review === item.value
                ? 'bg-primary text-white'
                : 'border border-slate-200 text-slate-500 dark:border-slate-700',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="暂无比赛" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>比赛</th>
                  <th className="w-20">赛制</th>
                  <th className="w-40">时间</th>
                  <th className="w-24">参赛</th>
                  <th className="w-28">状态</th>
                  <th className="w-44">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((contest: any) => (
                  <tr key={contest.id}>
                    <td>
                      <Link to={`/contest/${contest.id}`} className="hover:text-primary">
                        {contest.title}
                      </Link>
                      <div className="text-[11px] text-slate-400">
                        {contest.origin === 'user' ? `用户创建 · ${contest.owner_name ?? ''}` : '官方比赛'}
                      </div>
                    </td>
                    <td className="text-xs uppercase">{contest.rules}</td>
                    <td className="text-xs text-slate-500">
                      {formatTime(contest.start_time, false)}
                      <div>{formatTime(contest.end_time, false)}</div>
                    </td>
                    <td className="text-xs">{contest.participant_count}</td>
                    <td>
                      <span
                        className={classNames(
                          'rounded px-1.5 py-0.5 text-xs',
                          contest.review_status === 'approved'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                            : contest.review_status === 'pending'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
                        )}
                      >
                        {contest.review_status === 'approved' ? '已通过' : contest.review_status === 'pending' ? '待审核' : '已驳回'}
                      </span>
                      <div className="text-[11px] text-slate-400">
                        {contest.status === 'running' ? '进行中' : contest.status === 'upcoming' ? '未开始' : '已结束'}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <button type="button" className="text-primary hover:underline" onClick={() => openEditor(contest)}>
                          <Pencil className="mr-0.5 inline h-3.5 w-3.5" />
                          编辑
                        </button>
                        {contest.review_status !== 'approved' && (
                          <button type="button" className="text-emerald-600 hover:underline" onClick={() => reviewContest(contest, true)}>
                            <Check className="mr-0.5 inline h-3.5 w-3.5" />
                            通过
                          </button>
                        )}
                        {contest.review_status === 'pending' && (
                          <button type="button" className="text-amber-600 hover:underline" onClick={() => reviewContest(contest, false)}>
                            <X className="mr-0.5 inline h-3.5 w-3.5" />
                            驳回
                          </button>
                        )}
                        {contest.status === 'ended' && (
                          <button type="button" className="text-primary hover:underline" onClick={() => finalize(contest)}>
                            <Trophy className="mr-0.5 inline h-3.5 w-3.5" />
                            结算
                          </button>
                        )}
                        <button type="button" className="text-rose-500 hover:underline" onClick={() => remove(contest)}>
                          <Trash2 className="inline h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} size={30} total={data?.total ?? 0} onChange={setPage} />
      </div>

      <Modal
        open={Boolean(editing)}
        title={editing?.isNew ? '新建比赛' : `编辑比赛：${editing?.title ?? ''}`}
        onClose={() => setEditing(null)}
        width="max-w-3xl"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={save}>
              保存
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="比赛名称" required>
            <input className="input" value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="副标题">
            <input className="input" value={form.subtitle ?? ''} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="赛制">
              <select className="input" value={form.rules ?? 'acm'} onChange={(e) => setForm({ ...form, rules: e.target.value })}>
                <option value="acm">ACM</option>
                <option value="oi">OI</option>
                <option value="ioi">IOI</option>
              </select>
            </Field>
            <Field label="封榜时长（分钟）">
              <input
                className="input"
                type="number"
                value={form.freezeMinutes ?? 0}
                onChange={(e) => setForm({ ...form, freezeMinutes: Number(e.target.value) })}
              />
            </Field>
            <Field label="开始时间" required>
              <input
                className="input"
                type="datetime-local"
                value={form.startTime ?? ''}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              />
            </Field>
            <Field label="结束时间" required>
              <input
                className="input"
                type="datetime-local"
                value={form.endTime ?? ''}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
              />
            </Field>
          </div>
          <Field label="比赛题目 ID" hint="按顺序填写，用空格分隔；题目会按填写顺序编号为 A、B、C…">
            <input
              className="input"
              value={form.problemIds ?? ''}
              onChange={(e) => setForm({ ...form, problemIds: e.target.value })}
            />
          </Field>
          <Field label="比赛密码" hint="留空表示无需密码">
            <input
              className="input"
              value={form.password ?? ''}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <Field label="比赛说明（Markdown）">
            <textarea
              className="input min-h-[140px] font-mono text-xs"
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-300">
            {[
              ['needRegister', '需要报名'],
              ['showRank', '公开排行榜'],
              ['rated', '计入积分结算'],
              ['isPublic', '公开比赛'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={Boolean(form[key as string])}
                  onChange={(event) => setForm({ ...form, [key as string]: event.target.checked })}
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
