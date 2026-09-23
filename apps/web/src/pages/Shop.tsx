import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus2, Package, ShoppingBag, Sparkles, Trophy } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames } from '../lib/format';
import { EmptyState, Field, Loading, Modal, Section } from '../components/ui';
import { useToast } from '../components/Toast';

const ICONS: Record<string, any> = {
  trophy: Trophy,
  'file-plus': FilePlus2,
  package: Package,
  sparkles: Sparkles,
};

export default function Shop() {
  const { user, isAdmin, grants, refresh } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [payload, setPayload] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const result = await api.get<any>('/api/shop/items');
      setData(result);
    } catch {
      setData({ items: [], enabled: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const redeem = async () => {
    if (!selected) return;
    try {
      const result = await api.post<{ orderId: number; status: string }>('/api/shop/redeem', {
        itemId: selected.id,
        payload,
      });
      toast.success(
        result.status === 'approved'
          ? '兑换成功，资格已发放到你的账号'
          : '兑换申请已提交，等待管理员审核',
      );
      setSelected(null);
      setPayload({});
      void load();
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '兑换失败');
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <ShoppingBag className="h-5 w-5 text-primary" /> 积分商店
        </h1>
        <div className="flex items-center gap-3 text-sm">
          {user && (
            <span className="rounded-lg bg-primary/10 px-3 py-1.5 text-primary">
              我的积分：<b>{user.points}</b>
            </span>
          )}
          <Link to="/shop/orders" className="btn-ghost !py-1.5 text-xs">
            我的订单
          </Link>
        </div>
      </div>

      {!data?.enabled && (
        <div className="card p-4 text-sm text-amber-600 dark:text-amber-400">
          商店当前未开启，请联系管理员在「系统设置 → 积分与商店」中启用。
        </div>
      )}

      {user && (grants.problem || grants.contest) ? (
        <Section title="我的可用资格">
          <div className="flex flex-wrap gap-3 p-4 text-sm">
            <span className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              可创建比赛：{grants.contest ?? 0} 次
            </span>
            <span className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              可出题：{grants.problem ?? 0} 次
            </span>
            <span className="text-xs text-slate-500">
              创建比赛请到「比赛」页面，出题请到「题库 → 新建题目」。
            </span>
          </div>
        </Section>
      ) : null}

      {data?.items.length === 0 ? (
        <div className="card">
          <EmptyState title="商店暂未上架商品" description="管理员可以在控制面板中添加商品" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data?.items.map((item: any) => {
            const Icon = ICONS[item.icon] ?? Package;
            return (
              <div key={item.id} className="card flex flex-col p-4">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-primary/10 p-2 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <h2 className="font-semibold">{item.name}</h2>
                </div>
                <p className="mt-2 flex-1 whitespace-pre-line text-xs text-slate-500">{item.description}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-lg font-bold text-primary">{item.price} 积分</span>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    {item.stock >= 0 && <span>剩余 {Math.max(0, item.stock - item.soldCount)}</span>}
                    <span>已兑换 {item.soldCount}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className={classNames('mt-3 w-full', item.soldOut ? 'btn-ghost' : 'btn-primary')}
                  disabled={item.soldOut || !data.enabled}
                  onClick={() =>
                    user ? setSelected(item) : (window.location.href = '/login')
                  }
                >
                  {item.soldOut ? '已售罄' : user ? '立即兑换' : '登录后兑换'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Section title="积分规则">
        <ul className="list-disc space-y-1 px-4 py-3 pl-8 text-xs text-slate-500">
          <li>每通过一道题目获得积分，全站首杀还有额外奖励。</li>
          <li>兑换「创建一次比赛」后可到比赛页面创建自己的比赛，审核通过后生效。</li>
          <li>兑换「出一道题」后可到题库新建题目，上传测试数据并提交审核。</li>
          <li>订单被驳回时积分会自动退还。</li>
          {isAdmin && <li className="text-amber-600">管理员兑换无需审核，立即生效。</li>}
        </ul>
      </Section>

      <Modal
        open={Boolean(selected)}
        title={`兑换「${selected?.name ?? ''}」`}
        onClose={() => setSelected(null)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setSelected(null)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={redeem}>
              确认兑换（{selected?.price} 积分）
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            当前积分 {user?.points ?? 0}，兑换后将剩余 {(user?.points ?? 0) - (selected?.price ?? 0)} 积分。
          </p>
          {selected?.kind === 'contest' && (
            <>
              <Field label="比赛名称" required>
                <input
                  className="input"
                  value={payload.title ?? ''}
                  onChange={(event) => setPayload({ ...payload, title: event.target.value })}
                  placeholder="例如：我的第一场比赛"
                />
              </Field>
              <Field label="计划开始时间">
                <input
                  className="input"
                  type="datetime-local"
                  value={payload.startTime ?? ''}
                  onChange={(event) => setPayload({ ...payload, startTime: event.target.value })}
                />
              </Field>
              <Field label="备注">
                <textarea
                  className="input min-h-[80px]"
                  value={payload.note ?? ''}
                  onChange={(event) => setPayload({ ...payload, note: event.target.value })}
                  placeholder="赛制、题量等说明，方便管理员审核"
                />
              </Field>
            </>
          )}
          {(selected?.kind === 'problem' || selected?.kind === 'custom') && (
            <>
              <Field label="题目 / 用途名称" required={selected?.kind === 'problem'}>
                <input
                  className="input"
                  value={payload.title ?? ''}
                  onChange={(event) => setPayload({ ...payload, title: event.target.value })}
                />
              </Field>
              <Field label="说明">
                <textarea
                  className="input min-h-[80px]"
                  value={payload.note ?? ''}
                  onChange={(event) => setPayload({ ...payload, note: event.target.value })}
                />
              </Field>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
