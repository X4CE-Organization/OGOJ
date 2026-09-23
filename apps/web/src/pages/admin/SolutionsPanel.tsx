import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, EyeOff, Trash2 } from 'lucide-react';
import { api, query } from '../../lib/api';
import { classNames, fromNow } from '../../lib/format';
import { EmptyState, Loading, Pagination } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function SolutionsPanel() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pendingOnly, setPendingOnly] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(
        `/api/admin/solutions${query({ page, size: 30, pending: pendingOnly ? 'true' : '' })}`,
      );
      setData(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pendingOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const setPublic = async (solution: any, isPublic: boolean) => {
    try {
      await api.put(`/api/solutions/${solution.id}`, { isPublic });
      toast.success(isPublic ? '题解已公开' : '题解已下架');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const remove = async (solution: any) => {
    if (!window.confirm('确定删除这篇题解吗？')) return;
    await api.del(`/api/solutions/${solution.id}`);
    toast.success('已删除');
    void load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">题解审核</h1>
        <label className="flex items-center gap-1.5 text-sm text-slate-500">
          <input type="checkbox" checked={pendingOnly} onChange={(event) => setPendingOnly(event.target.checked)} />
          只看未公开
        </label>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="没有需要处理的题解" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>标题</th>
                  <th className="w-28">作者</th>
                  <th className="w-28">题目</th>
                  <th className="w-24">状态</th>
                  <th className="w-32">时间</th>
                  <th className="w-48">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((solution: any) => (
                  <tr key={solution.id}>
                    <td>
                      <Link to={`/solution/${solution.id}`} className="hover:text-primary">
                        {solution.title}
                      </Link>
                    </td>
                    <td className="text-xs">{solution.username}</td>
                    <td className="text-xs">
                      <Link to={`/problem/${solution.pid}`} className="link">
                        {solution.pid}
                      </Link>
                    </td>
                    <td>
                      <span
                        className={classNames(
                          'rounded px-1.5 py-0.5 text-xs',
                          solution.is_public
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
                        )}
                      >
                        {solution.is_public ? '已公开' : '待审核'}
                      </span>
                    </td>
                    <td className="text-xs text-slate-400">{fromNow(solution.created_at)}</td>
                    <td>
                      <div className="flex gap-2 text-xs">
                        {!solution.is_public ? (
                          <button type="button" className="text-emerald-600 hover:underline" onClick={() => setPublic(solution, true)}>
                            <Check className="mr-0.5 inline h-3.5 w-3.5" />
                            通过
                          </button>
                        ) : (
                          <button type="button" className="text-amber-600 hover:underline" onClick={() => setPublic(solution, false)}>
                            <EyeOff className="mr-0.5 inline h-3.5 w-3.5" />
                            下架
                          </button>
                        )}
                        <button type="button" className="text-rose-500 hover:underline" onClick={() => remove(solution)}>
                          <Trash2 className="mr-0.5 inline h-3.5 w-3.5" />
                          删除
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
    </div>
  );
}
