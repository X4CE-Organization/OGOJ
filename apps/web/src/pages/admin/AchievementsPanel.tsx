import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { classNames } from '../../lib/format';
import { EmptyState, Field, Loading, Modal, Section } from '../../components/ui';
import { useToast } from '../../components/Toast';

const CONDITION_TYPES = [
  { value: 'solved_count', label: '通过题目数' },
  { value: 'accepted_count', label: 'AC 提交数' },
  { value: 'submission_count', label: '提交总数' },
  { value: 'points', label: '积分' },
  { value: 'register_days', label: '注册天数' },
  { value: 'contest_count', label: '参赛场次' },
  { value: 'first_blood', label: '全站首杀次数' },
  { value: 'solution_count', label: '发布题解数' },
  { value: 'article_count', label: '发布文章数' },
  { value: 'discussion_count', label: '发帖数' },
  { value: 'reply_count', label: '回复数' },
  { value: 'hack_count', label: '发起 Hack 次数' },
  { value: 'hack_success', label: 'Hack 成功次数' },
  { value: 'shop_order', label: '商店兑换次数' },
  { value: 'difficulty_clear', label: '通过的最高难度（1-7）' },
  { value: 'day_solved', label: '单日最多通过题数' },
  { value: 'team_count', label: '加入团队数' },
  { value: 'oauth_bound', label: '绑定的第三方账号数' },
  { value: 'night_owl', label: '凌晨通过题目（0/1）' },
  { value: 'early_bird', label: '清晨通过题目（0/1）' },
  { value: 'perfect_score', label: '取得满分（0/1）' },
];

const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const CATEGORIES = ['milestone', 'skill', 'contest', 'community', 'special'];

export default function AchievementsPanel() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [grantFor, setGrantFor] = useState<any>(null);
  const [grantUser, setGrantUser] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<any>('/api/admin/achievements'));
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

  const openEditor = (item?: any) => {
    if (!item) {
      setForm({
        code: '',
        name: '',
        description: '',
        icon: '🏅',
        category: 'milestone',
        rarity: 'common',
        conditionType: 'solved_count',
        threshold: 10,
        points: 5,
        sort: 100,
        isActive: true,
      });
      setEditing({ isNew: true });
      return;
    }
    setForm({
      code: item.code,
      name: item.name,
      description: item.description,
      icon: item.icon,
      category: item.category,
      rarity: item.rarity,
      conditionType: item.conditionParsed?.type ?? 'solved_count',
      threshold: item.conditionParsed?.threshold ?? 1,
      points: item.points,
      sort: item.sort,
      isActive: Boolean(item.is_active),
    });
    setEditing(item);
  };

  const save = async () => {
    const payload = {
      code: form.code,
      name: form.name,
      description: form.description,
      icon: form.icon,
      category: form.category,
      rarity: form.rarity,
      condition: { type: form.conditionType, threshold: Number(form.threshold) || 1 },
      points: Number(form.points) || 0,
      sort: Number(form.sort) || 0,
      isActive: form.isActive,
    };
    try {
      if (editing?.isNew) {
        await api.post('/api/admin/achievements', payload);
        toast.success('成就已创建');
      } else {
        await api.put(`/api/admin/achievements/${editing.id}`, payload);
        toast.success('成就已保存');
      }
      setEditing(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const remove = async (item: any) => {
    if (!window.confirm(`确定删除成就「${item.name}」吗？已解锁的记录也会被一并删除。`)) return;
    await api.del(`/api/admin/achievements/${item.id}`);
    toast.success('已删除');
    void load();
  };

  const grant = async () => {
    if (!grantFor || !grantUser.trim()) return;
    try {
      await api.post(`/api/admin/achievements/${grantFor.id}/grant`, { username: grantUser.trim() });
      toast.success(`已将「${grantFor.name}」授予 ${grantUser}`);
      setGrantFor(null);
      setGrantUser('');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '授予失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">成就徽章管理</h1>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {data && (
            <span>
              共 {data.stats.total} 个徽章 · 启用 {data.stats.active} · 已解锁 {data.stats.unlocked} 次
            </span>
          )}
          <button type="button" className="btn-primary !py-1.5 text-xs" onClick={() => openEditor()}>
            <Plus className="h-3.5 w-3.5" /> 新建成就
          </button>
        </div>
      </div>

      <Section title="徽章列表">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="还没有成就" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-16">图标</th>
                  <th>成就</th>
                  <th className="w-24">分类</th>
                  <th className="w-24">稀有度</th>
                  <th className="w-48">解锁条件</th>
                  <th className="w-20">奖励</th>
                  <th className="w-20">获得人数</th>
                  <th className="w-24">状态</th>
                  <th className="w-40">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item: any) => (
                  <tr key={item.id} className={classNames(!item.is_active && 'opacity-60')}>
                    <td className="text-xl">{item.icon}</td>
                    <td>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {item.code}
                        {item.is_builtin ? ' · 内置' : ''}
                      </div>
                      <div className="max-w-md truncate text-[11px] text-slate-400">{item.description}</div>
                    </td>
                    <td className="text-xs">{item.category}</td>
                    <td className="text-xs">{item.rarity}</td>
                    <td className="text-xs text-slate-500">
                      {CONDITION_TYPES.find((type) => type.value === item.conditionParsed?.type)?.label ??
                        item.conditionParsed?.type}{' '}
                      ≥ {item.conditionParsed?.threshold}
                    </td>
                    <td className="text-xs text-primary">{item.points > 0 ? `+${item.points}` : '-'}</td>
                    <td className="text-xs">{item.holder_count}</td>
                    <td>
                      <span
                        className={classNames(
                          'rounded px-1.5 py-0.5 text-xs',
                          item.is_active
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-500 dark:bg-slate-800',
                        )}
                      >
                        {item.is_active ? '启用' : '停用'}
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <button type="button" className="text-primary hover:underline" onClick={() => openEditor(item)}>
                          <Pencil className="mr-0.5 inline h-3.5 w-3.5" />
                          编辑
                        </button>
                        <button
                          type="button"
                          className="text-emerald-600 hover:underline"
                          onClick={() => {
                            setGrantFor(item);
                            setGrantUser('');
                          }}
                        >
                          <Sparkles className="mr-0.5 inline h-3.5 w-3.5" />
                          授予
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

      <Section title="可用条件类型">
        <p className="p-4 text-xs text-slate-500">
          条件由「类型 + 阈值」组成，系统在通过题目、参加比赛、发布内容、Hack、兑换商品等事件后自动检查；
          也可以由用户在成就页点击「检查我的成就」手动触发。
        </p>
        <div className="flex flex-wrap gap-1.5 px-4 pb-4">
          {CONDITION_TYPES.map((type) => (
            <span key={type.value} className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
              <code className="text-[11px] text-slate-400">{type.value}</code> {type.label}
            </span>
          ))}
        </div>
      </Section>

      <Modal
        open={Boolean(editing)}
        title={editing?.isNew ? '新建成就' : `编辑成就：${editing?.name ?? ''}`}
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
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="成就名称" required>
              <input className="input" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="成就代码" hint="唯一标识，留空自动生成">
              <input className="input" value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Field>
            <Field label="图标 (Emoji)">
              <input className="input" value={form.icon ?? ''} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
            </Field>
            <Field label="排序">
              <input
                className="input"
                type="number"
                value={form.sort ?? 100}
                onChange={(e) => setForm({ ...form, sort: Number(e.target.value) })}
              />
            </Field>
            <Field label="分类">
              <select className="input" value={form.category ?? 'milestone'} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="稀有度">
              <select className="input" value={form.rarity ?? 'common'} onChange={(e) => setForm({ ...form, rarity: e.target.value })}>
                {RARITIES.map((rarity) => (
                  <option key={rarity} value={rarity}>
                    {rarity}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="解锁条件类型">
              <select
                className="input"
                value={form.conditionType ?? 'solved_count'}
                onChange={(e) => setForm({ ...form, conditionType: e.target.value })}
              >
                {CONDITION_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="条件阈值">
              <input
                className="input"
                type="number"
                value={form.threshold ?? 1}
                onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })}
              />
            </Field>
            <Field label="奖励积分">
              <input
                className="input"
                type="number"
                value={form.points ?? 0}
                onChange={(e) => setForm({ ...form, points: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="成就描述">
            <textarea
              className="input min-h-[80px]"
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={Boolean(form.isActive)}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            启用该成就
          </label>
        </div>
      </Modal>

      <Modal
        open={Boolean(grantFor)}
        title={`授予成就：${grantFor?.name ?? ''}`}
        onClose={() => setGrantFor(null)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setGrantFor(null)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={grant}>
              授予
            </button>
          </>
        }
      >
        <Field label="用户名" required>
          <input
            className="input"
            value={grantUser}
            onChange={(event) => setGrantUser(event.target.value)}
            placeholder="输入要授予徽章的用户名"
          />
        </Field>
      </Modal>
    </div>
  );
}
