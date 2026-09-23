import { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { api, query } from '../../lib/api';
import { classNames, formatTime } from '../../lib/format';
import { EmptyState, Loading, Pagination } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function OrdersPanel() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('pending');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(`/api/admin/shop/orders${query({ page, size: 30, status })}`);
      setData(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (order: any, approve: boolean) => {
    const note = approve ? '' : window.prompt('驳回原因', '申请信息不完整') ?? '';
    try {
      await api.post(`/api/admin/shop/orders/${order.id}/review`, { approve, note });
      toast.success(approve ? '已通过，资格已发放' : '已驳回，积分已退还');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">
          订单审核
          {data?.pending ? <span className="ml-2 text-sm text-amber-600">{data.pending} 个待处理</span> : null}
        </h1>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        {[
          { value: 'pending', label: '待审核' },
          { value: 'approved', label: '已通过' },
          { value: 'completed', label: '已完成' },
          { value: 'rejected', label: '已驳回' },
          { value: '', label: '全部' },
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
          <EmptyState title="没有订单" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-36">订单号</th>
                  <th className="w-32">用户</th>
                  <th>商品 / 申请内容</th>
                  <th className="w-20">积分</th>
                  <th className="w-32">时间</th>
                  <th className="w-32">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((order: any) => (
                  <tr key={order.id}>
                    <td className="font-mono text-xs">{order.order_no}</td>
                    <td className="text-sm">
                      {order.username}
                      <div className="text-[11px] text-slate-400">余额 {order.points}</div>
                    </td>
                    <td>
                      <div className="font-medium">{order.item_name}</div>
                      {order.payload && Object.keys(order.payload).length > 0 && (
                        <pre className="mt-1 max-w-md whitespace-pre-wrap rounded bg-slate-50 p-1.5 text-[11px] text-slate-500 dark:bg-slate-800">
{JSON.stringify(order.payload, null, 2)}
                        </pre>
                      )}
                      {order.note && <div className="mt-1 text-[11px] text-rose-500">备注：{order.note}</div>}
                    </td>
                    <td className="text-primary">{order.price}</td>
                    <td className="text-xs text-slate-500">{formatTime(order.created_at)}</td>
                    <td>
                      {order.status === 'pending' ? (
                        <div className="flex gap-2 text-xs">
                          <button type="button" className="text-emerald-600 hover:underline" onClick={() => review(order, true)}>
                            <Check className="mr-0.5 inline h-3.5 w-3.5" />
                            通过
                          </button>
                          <button type="button" className="text-rose-500 hover:underline" onClick={() => review(order, false)}>
                            <X className="mr-0.5 inline h-3.5 w-3.5" />
                            驳回
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">{order.status}</span>
                      )}
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
