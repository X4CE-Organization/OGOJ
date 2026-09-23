import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { classNames } from '../../lib/format';
import { EmptyState, Field, Loading, Modal, Section } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function ShopPanel() {
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<{ items: any[] }>('/api/admin/shop/items');
      setItems(result.items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const presets = async () => {
    try {
      const result = await api.get<any>('/api/shop/presets');
      const preset = result.presets[0];
      setForm({
        name: preset.name,
        slug: preset.slug,
        description: preset.description,
        price: preset.price,
        kind: preset.kind,
        icon: preset.icon,
        stock: -1,
        maxPerUser: 0,
        isActive: true,
        sort: 1,
        payload: '{}',
      });
      setEditing({ isNew: true });
    } catch {
      setEditing({ isNew: true });
      setForm({ name: '', slug: '', kind: 'contest', price: 100, stock: -1, maxPerUser: 0, isActive: true, sort: 0, payload: '{}' });
    }
  };

  const save = async () => {
    try {
      const payload = { ...form, payload: JSON.parse(form.payload || '{}') };
      if (editing?.isNew) {
        await api.post('/api/admin/shop/items', payload);
        toast.success('商品已创建');
      } else {
        await api.put(`/api/admin/shop/items/${editing.id}`, payload);
        toast.success('商品已保存');
      }
      setEditing(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败（请检查 JSON 格式）');
    }
  };

  const remove = async (item: any) => {
    if (!window.confirm(`确定删除商品「${item.name}」吗？`)) return;
    await api.del(`/api/admin/shop/items/${item.id}`);
    toast.success('已删除');
    void load();
  };

  const toggle = async (item: any) => {
    await api.put(`/api/admin/shop/items/${item.id}`, { isActive: !item.is_active });
    void load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">商品管理</h1>
        <button type="button" className="btn-primary !py-1.5 text-xs" onClick={presets}>
          <Plus className="h-3.5 w-3.5" /> 新建商品
        </button>
      </div>

      <Section title="商品列表">
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title="还没有商品" description="创建「创建一次比赛」「出一道题」等商品" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>商品</th>
                  <th className="w-28">类型</th>
                  <th className="w-24">价格</th>
                  <th className="w-24">库存</th>
                  <th className="w-24">每人限购</th>
                  <th className="w-24">状态</th>
                  <th className="w-32">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="font-medium">{item.name}</div>
                      <div className="max-w-md truncate text-[11px] text-slate-400">{item.description}</div>
                    </td>
                    <td className="text-xs">{item.kind}</td>
                    <td className="text-primary">{item.price}</td>
                    <td className="text-xs">{item.stock < 0 ? '不限' : item.stock}</td>
                    <td className="text-xs">{item.max_per_user || '不限'}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => toggle(item)}
                        className={classNames(
                          'rounded px-1.5 py-0.5 text-xs',
                          item.is_active
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-500 dark:bg-slate-800',
                        )}
                      >
                        {item.is_active ? '上架中' : '已下架'}
                      </button>
                    </td>
                    <td>
                      <div className="flex gap-2 text-xs">
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => {
                            setEditing(item);
                            setForm({ ...item, payload: JSON.stringify(item.payload ?? {}, null, 2) });
                          }}
                        >
                          <Pencil className="mr-0.5 inline h-3.5 w-3.5" />
                          编辑
                        </button>
                        <button type="button" className="text-rose-500 hover:underline" onClick={() => remove(item)}>
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
      </Section>

      <Section title="说明">
        <ul className="list-disc space-y-1 px-4 py-3 pl-8 text-xs text-slate-500">
          <li>
            <b>类型</b>：contest 表示兑换后获得创建比赛资格；problem 表示出题资格；custom 为自定义商品（可通过 payload 配置
            <code>{'{ "grantKind": "contest", "total": 5 }'}</code> 一次性发放多次资格）。
          </li>
          <li>价格为积分数量，修改后立即对新订单生效。</li>
          <li>库存 -1 表示不限量；每人限购 0 表示不限次数。</li>
        </ul>
      </Section>

      <Modal
        open={Boolean(editing)}
        title={editing?.isNew ? '新建商品' : `编辑商品：${editing?.name ?? ''}`}
        onClose={() => setEditing(null)}
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
          <Field label="商品名称" required>
            <input className="input" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="类型">
              <select className="input" value={form.kind ?? 'contest'} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="contest">创建比赛资格</option>
                <option value="problem">出题资格</option>
                <option value="custom">自定义 / 其它</option>
              </select>
            </Field>
            <Field label="图标">
              <select className="input" value={form.icon ?? 'package'} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
                <option value="trophy">奖杯</option>
                <option value="file-plus">文件+</option>
                <option value="package">包裹</option>
                <option value="sparkles">闪光</option>
              </select>
            </Field>
            <Field label="价格（积分）">
              <input
                className="input"
                type="number"
                value={form.price ?? 0}
                onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
              />
            </Field>
            <Field label="库存（-1 不限）">
              <input
                className="input"
                type="number"
                value={form.stock ?? -1}
                onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })}
              />
            </Field>
            <Field label="每人限购（0 不限）">
              <input
                className="input"
                type="number"
                value={form.maxPerUser ?? 0}
                onChange={(e) => setForm({ ...form, maxPerUser: Number(e.target.value) })}
              />
            </Field>
            <Field label="排序">
              <input
                className="input"
                type="number"
                value={form.sort ?? 0}
                onChange={(e) => setForm({ ...form, sort: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="商品描述" hint="支持换行，显示在商品卡片上">
            <textarea
              className="input min-h-[100px]"
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <Field label="附加参数 (JSON)" hint='例如 {"grantKind":"contest","total":5}'>
            <textarea
              className="input min-h-[80px] font-mono text-xs"
              value={form.payload ?? '{}'}
              onChange={(e) => setForm({ ...form, payload: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={Boolean(form.isActive)}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            上架销售
          </label>
        </div>
      </Modal>
    </div>
  );
}
