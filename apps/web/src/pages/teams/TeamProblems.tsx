import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Pin, Plus, Trash2 } from 'lucide-react';
import { api, query } from '../../lib/api';
import { classNames, DIFFICULTY_NAMES } from '../../lib/format';
import { DifficultyBadge, EmptyState, Field, Loading, Modal, Pagination, StatusText } from '../../components/ui';
import { useToast } from '../../components/Toast';
import type { TeamContextValue } from './TeamLayout';

export default function TeamProblems() {
  const ctx = useOutletContext<TeamContextValue>();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ problemId: '', note: '' });
  const [preview, setPreview] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await api.get<any>(
          `/api/teams/${ctx.team.slug}/problems${query({ page, size: 50, q: keyword, difficulty })}`,
        ),
      );
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ctx.team.slug, page, keyword, difficulty]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 支持填题目 ID 或 P1001 这样的编号，先查一下确认存在 */
  const lookup = async (value: string) => {
    const term = value.trim();
    if (!term) {
      setPreview(null);
      return;
    }
    try {
      const result = await api.get<any>(`/api/problems/${encodeURIComponent(term)}`);
      setPreview(result.problem);
      setForm((current) => ({ ...current, problemId: String(result.problem.id) }));
    } catch {
      setPreview(null);
    }
  };

  const add = async () => {
    if (!preview) {
      toast.error('请先填写有效的题目编号');
      return;
    }
    try {
      await api.post(`/api/teams/${ctx.team.slug}/problems`, { problemId: preview.id, note: form.note });
      toast.success(`已添加 ${preview.pid}`);
      setForm({ problemId: '', note: '' });
      setPreview(null);
      setAdding(false);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '添加失败');
    }
  };

  const remove = async (problem: any) => {
    if (!window.confirm(`确定把 ${problem.pid} 移出团队题目吗？`)) return;
    await api.del(`/api/teams/${ctx.team.slug}/problems/${problem.id}`);
    toast.success('已移除');
    void load();
  };

  const updateProblem = async (problem: any, patch: Record<string, unknown>) => {
    await api.put(`/api/teams/${ctx.team.slug}/problems/${problem.id}`, patch);
    void load();
  };

  const total = data?.total ?? 0;
  const solved = data?.solved ?? 0;

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <input
          className="input !w-56"
          placeholder="搜索题目名称 / 编号"
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value);
            setPage(1);
          }}
        />
        <select
          className="input !w-32"
          value={difficulty}
          onChange={(event) => {
            setDifficulty(event.target.value);
            setPage(1);
          }}
        >
          <option value="">全部难度</option>
          {DIFFICULTY_NAMES.map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </select>
        {data?.canManage && (
          <button type="button" className="btn-primary ml-auto !py-1.5 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> 添加题目
          </button>
        )}
        <span className={classNames('text-xs text-slate-400', !data?.canManage && 'ml-auto')}>
          共 {total} 题{data?.solved !== undefined ? ` · 我已通过 ${solved} 题` : ''}
        </span>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="团队还没有题目" description="把常练的题目加进来，方便队友一起刷" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-24">编号</th>
                  <th>题目</th>
                  <th className="w-28">难度</th>
                  <th className="hidden w-64 md:table-cell">团队备注</th>
                  <th className="w-28">我的状态</th>
                  <th className="w-28">通过率</th>
                  {data.canManage && <th className="w-32">操作</th>}
                </tr>
              </thead>
              <tbody>
                {data.items.map((problem: any) => (
                  <tr key={problem.id}>
                    <td className="font-mono text-xs text-slate-400">
                      {problem.is_pinned && <Pin className="mr-1 inline h-3 w-3 text-rose-500" />}
                      {problem.pid}
                    </td>
                    <td>
                      <Link to={`/problem/${problem.pid}`} className="hover:text-primary">
                        {problem.title}
                      </Link>
                    </td>
                    <td>
                      <DifficultyBadge value={problem.difficulty} compact />
                    </td>
                    <td className="hidden max-w-sm truncate text-xs text-slate-500 md:table-cell">
                      {problem.note || '-'}
                    </td>
                    <td>
                      {problem.myAccepted ? (
                        <StatusText status="AC" />
                      ) : problem.myAttempts ? (
                        <span className="text-xs text-slate-500">尝试 {problem.myAttempts} 次</span>
                      ) : (
                        <span className="text-xs text-slate-400">未提交</span>
                      )}
                    </td>
                    <td className="text-xs text-slate-500">
                      {problem.submit_count > 0
                        ? `${Math.round((problem.accepted_count / problem.submit_count) * 1000) / 10}%`
                        : '-'}
                    </td>
                    {data.canManage && (
                      <td>
                        <div className="flex gap-2 text-xs">
                          <button
                            type="button"
                            className="text-primary hover:underline"
                            onClick={() => {
                              const note = window.prompt('团队备注', problem.note ?? '');
                              if (note !== null) void updateProblem(problem, { note });
                            }}
                          >
                            备注
                          </button>
                          <button
                            type="button"
                            className="text-slate-500 hover:underline"
                            onClick={() => updateProblem(problem, { isPinned: !problem.is_pinned })}
                          >
                            {problem.is_pinned ? '取消置顶' : '置顶'}
                          </button>
                          <button type="button" className="text-rose-500 hover:underline" onClick={() => remove(problem)}>
                            <Trash2 className="inline h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} size={50} total={total} onChange={setPage} />
      </div>

      <Modal
        open={adding}
        title="添加团队题目"
        onClose={() => setAdding(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={add}>
              添加
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="题目编号" required hint="支持题目 ID 或编号，例如 P1001">
            <input
              className="input"
              value={form.problemId}
              onChange={(event) => {
                setForm({ ...form, problemId: event.target.value });
                void lookup(event.target.value);
              }}
              placeholder="P1001"
            />
          </Field>
          {preview && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
              已找到：<b>{preview.pid}</b> {preview.title}
              <DifficultyBadge value={preview.difficulty} compact />
            </div>
          )}
          <Field label="团队备注" hint="例如：本周练习 / 需要用到并查集">
            <input className="input" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
