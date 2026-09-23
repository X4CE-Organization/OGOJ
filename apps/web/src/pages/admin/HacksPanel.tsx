import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Trash2 } from 'lucide-react';
import { api, query } from '../../lib/api';
import { classNames, fromNow } from '../../lib/format';
import { EmptyState, Loading, Pagination, Section } from '../../components/ui';
import { useToast } from '../../components/Toast';

const VERDICT: Record<string, string> = {
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  fail: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  error: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  pending: 'bg-slate-100 text-slate-500 dark:bg-slate-800',
};

export default function HacksPanel() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [verdict, setVerdict] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<any>(`/api/admin/hacks${query({ page, size: 50, verdict })}`));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, verdict]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (hack: any) => {
    if (!window.confirm(`确定删除 Hack #${hack.id} 吗？对应的测试数据会被移除并重新评测目标提交。`)) return;
    try {
      await api.del(`/api/admin/hacks/${hack.id}`);
      toast.success('已删除，目标提交已加入重测队列');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const rejudge = async (hack: any) => {
    try {
      await api.post(`/api/admin/hacks/${hack.id}/rejudge`);
      toast.success('已加入重测队列');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Hack 管理</h1>

      {data?.stats && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ['全部 Hack', Object.values(data.stats).reduce((a: number, b: any) => a + b, 0)],
            ['成功', data.stats.success ?? 0],
            ['失败', data.stats.fail ?? 0],
            ['数据无效', data.stats.error ?? 0],
          ].map(([label, value]) => (
            <div key={label as string} className="card p-4">
              <div className="text-xs text-slate-400">{label}</div>
              <div className="mt-1 text-xl font-semibold text-primary">{value}</div>
            </div>
          ))}
        </div>
      )}

      <Section
        title="Hack 记录"
        action={
          <div className="flex items-center gap-2">
            <select
              className="input !w-32 !py-1 text-xs"
              value={verdict}
              onChange={(event) => {
                setVerdict(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部结果</option>
              <option value="success">成功</option>
              <option value="fail">失败</option>
              <option value="error">数据无效</option>
            </select>
          </div>
        }
      >
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="暂无 Hack 记录" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-16">#</th>
                  <th className="w-24">结果</th>
                  <th className="w-32">题目</th>
                  <th className="w-32">Hacker</th>
                  <th className="w-32">被 Hack</th>
                  <th className="w-32">状态变化</th>
                  <th>信息</th>
                  <th className="w-32">时间</th>
                  <th className="w-32">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((hack: any) => (
                  <tr key={hack.id}>
                    <td className="font-mono text-xs">{hack.id}</td>
                    <td>
                      <span className={classNames('rounded px-1.5 py-0.5 text-xs', VERDICT[hack.verdict])}>
                        {hack.verdict}
                      </span>
                    </td>
                    <td className="text-xs">
                      <Link to={`/problem/${hack.pid}`} className="link">
                        {hack.pid}
                      </Link>
                    </td>
                    <td className="text-xs">{hack.hacker_username}</td>
                    <td className="text-xs">{hack.target_username}</td>
                    <td className="text-xs">
                      {hack.status_before} → {hack.status_after}
                    </td>
                    <td className="max-w-sm truncate text-xs text-slate-500" title={hack.message}>
                      {hack.message}
                    </td>
                    <td className="text-xs text-slate-400">{fromNow(hack.created_at)}</td>
                    <td>
                      <div className="flex gap-2 text-xs">
                        <button type="button" className="text-primary hover:underline" onClick={() => rejudge(hack)}>
                          <RefreshCw className="inline h-3.5 w-3.5" />
                        </button>
                        <button type="button" className="text-rose-500 hover:underline" onClick={() => remove(hack)}>
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
      </Section>

      <Section title="Hack 说明">
        <ul className="list-disc space-y-1 p-4 pl-8 text-xs text-slate-500">
          <li>Hack 数据由题目配置的「参考程序」生成标准答案，随后加入该题目的测试集并重新评测目标提交。</li>
          <li>删除一条 Hack 会同时删除它引入的测试数据，并把目标提交重新评测回原始结果。</li>
          <li>题目是否允许 Hack、比赛是否允许 Hack 分别由题目设置和比赛设置控制。</li>
        </ul>
      </Section>
    </div>
  );
}
