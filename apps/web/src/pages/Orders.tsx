import { useCallback, useEffect, useState } from 'react';
import { api, query } from '../lib/api';
import { classNames, formatTime } from '../lib/format';
import { EmptyState, Loading, Pagination } from '../components/ui';
import { useToast } from '../components/Toast';

const STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: '待审核', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  approved: { label: '已通过', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  completed: { label: '已完成', className: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300' },
  rejected: { label: '已驳回', className: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300' },
  cancelled: { label: '已取消', className: 'bg-slate-100 text-slate-500 dark:bg-slate-800' },
};

export default function Orders() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(`/api/shop/orders${query({ page, size: 20, status })}`);
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const cancel = async (id: number) => {
    if (!window.confirm('确定取消该订单吗？积分将退回到你的账号。')) return;
    try {
      await api.post(`/api/shop/orders/${id}/cancel`);
      toast.success('订单已取消，积分已退还');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '取消失败');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">我的订单</h1>
        {data && <span className="text-sm text-slate-500">当前积分：{data.points}</span>}
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
              setStatus(item.value);
              setPage(1);
            }}
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
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="还没有订单" description="到商店用积分兑换比赛与出题资格吧" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-40">订单号</th>
                  <th>商品</th>
                  <th className="w-24">积分</th>
                  <th className="w-28">状态</th>
                  <th className="w-36">申请时间</th>
                  <th>备注</th>
                  <th className="w-24">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((order: any) => (
                  <tr key={order.id}>
                    <td className="font-mono text-xs">{order.order_no}</td>
                    <td>{order.item_name}</td>
                    <td className="text-primary">{order.price}</td>
                    <td>
                      <span className={classNames('rounded px-1.5 py-0.5 text-xs', STATUS[order.status]?.className)}>
                        {STATUS[order.status]?.label ?? order.status}
                      </span>
                    </td>
                    <td className="text-xs text-slate-500">{formatTime(order.created_at)}</td>
                    <td className="max-w-xs text-xs text-slate-500">{order.note || '-'}</td>
                    <td>
                      {order.status === 'pending' && (
                        <button type="button" className="text-xs text-rose-500 hover:underline" onClick={() => cancel(order.id)}>
                          取消
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={page}
          size={20}
          total={data?.total ?? 0}
          onChange={setPage}
        />
      </div>
    </div>
  );
}
