import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { api, query } from '../../lib/api';
import { classNames, fromNow } from '../../lib/format';
import { DifficultyBadge, EmptyState, Loading, Pagination } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function ProblemsPanel() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [review, setReview] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(`/api/admin/problems${query({ page, size: 50, review, q: search })}`);
      setData(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, review, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const reviewProblem = async (problem: any, approve: boolean) => {
    const note = approve ? '' : window.prompt('驳回原因', '题目描述或数据需要修改') ?? '';
    try {
      await api.post(`/api/admin/problems/${problem.id}/review`, { approve, note });
      toast.success(approve ? '已通过审核' : '已驳回');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const remove = async (problem: any) => {
    if (!window.confirm(`确定删除题目 ${problem.pid} 吗？（软删除，可在数据库中恢复）`)) return;
    try {
      await api.del(`/api/problems/${problem.id}`);
      toast.success('已删除');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const rejudge = async (problem: any) => {
    if (!window.confirm(`确定重测 ${problem.pid} 的全部提交吗？`)) return;
    try {
      const result = await api.post<{ affected: number }>('/api/submissions/rejudge', { problemId: problem.id });
      toast.success(`已加入重测队列：${result.affected} 条`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重测失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">题目管理</h1>
        <Link to="/admin/problems/new" className="btn-primary !py-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" /> 新建题目
        </Link>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => setReview('')}
          className={classNames(
            'rounded-lg px-3 py-1.5 text-sm',
            !review ? 'bg-primary text-white' : 'border border-slate-200 text-slate-500 dark:border-slate-700',
          )}
        >
          全部
        </button>
        {[
          { value: 'pending', label: '待审核' },
          { value: 'approved', label: '已通过' },
          { value: 'rejected', label: '已驳回' },
        ].map((item) => (
          <button
            key={item.value}
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
        <input
          className="input !w-56"
          placeholder="搜索题目编号 / 标题"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="没有符合条件的题目" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-24">编号</th>
                  <th>题目</th>
                  <th className="w-28">难度</th>
                  <th className="w-24">测试点</th>
                  <th className="w-24">提交</th>
                  <th className="w-28">状态</th>
                  <th className="w-40">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((problem: any) => (
                  <tr key={problem.id}>
                    <td className="font-mono text-xs">{problem.pid}</td>
                    <td>
                      <Link to={`/problem/${problem.pid}`} className="hover:text-primary">
                        {problem.title}
                      </Link>
                      <div className="text-[11px] text-slate-400">
                        {problem.source_type === 'user' ? '用户出题' : '官方题目'}
                        {problem.owner_name ? ` · ${problem.owner_name}` : ''} · {fromNow(problem.updated_at)}
                      </div>
                    </td>
                    <td>
                      <DifficultyBadge value={problem.difficulty} compact />
                    </td>
                    <td className={problem.testcase_count ? '' : 'text-rose-500'}>
                      {problem.testcase_count}
                    </td>
                    <td className="text-xs text-slate-500">
                      {problem.accepted_count} / {problem.submit_count}
                    </td>
                    <td>
                      <span
                        className={classNames(
                          'rounded px-1.5 py-0.5 text-xs',
                          problem.review_status === 'approved'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                            : problem.review_status === 'pending'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
                        )}
                      >
                        {problem.review_status === 'approved' ? '已通过' : problem.review_status === 'pending' ? '待审核' : '已驳回'}
                      </span>
                      {!problem.is_public && <div className="text-[11px] text-slate-400">未公开</div>}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Link to={`/admin/problems/${problem.id}/edit`} className="text-primary hover:underline">
                          <Pencil className="mr-0.5 inline h-3.5 w-3.5" />
                          编辑
                        </Link>
                        {problem.review_status !== 'approved' && (
                          <button type="button" className="text-emerald-600 hover:underline" onClick={() => reviewProblem(problem, true)}>
                            <Check className="mr-0.5 inline h-3.5 w-3.5" />
                            通过
                          </button>
                        )}
                        {problem.review_status !== 'rejected' && (
                          <button type="button" className="text-amber-600 hover:underline" onClick={() => reviewProblem(problem, false)}>
                            <X className="mr-0.5 inline h-3.5 w-3.5" />
                            驳回
                          </button>
                        )}
                        <button type="button" className="text-slate-500 hover:underline" onClick={() => rejudge(problem)}>
                          <RefreshCw className="inline h-3.5 w-3.5" />
                        </button>
                        <button type="button" className="text-rose-500 hover:underline" onClick={() => remove(problem)}>
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
        <Pagination page={page} size={50} total={data?.total ?? 0} onChange={setPage} />
      </div>
    </div>
  );
}
