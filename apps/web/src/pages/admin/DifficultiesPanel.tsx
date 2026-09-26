import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { classNames } from '../../lib/format';
import { DifficultyBadge, Field, Loading, Modal, Section } from '../../components/ui';
import ColorPicker, { COLOR_PRESETS, ColorBoard } from '../../components/ColorPicker';
import { useToast } from '../../components/Toast';

export default function DifficultiesPanel() {
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', color: COLOR_PRESETS[9], colorDark: '' });
  /** 点铅笔打开的编辑弹窗：上面改名字，下面颜色板 */
  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: '', color: '', colorDark: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ difficulties: any[] }>('/api/difficulties');
      setItems(data.difficulties ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (item: any, patch: Record<string, unknown>) => {
    try {
      await api.put(`/api/admin/difficulties/${item.id}`, patch);
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, ...patch } : row)));
      // 让全站的难度缓存立刻生效
      const data = await api.get<{ difficulties: any[] }>('/api/difficulties');
      window.dispatchEvent(new CustomEvent('ogoj:difficulties'));
      setItems(data.difficulties ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const openEditor = (item: any) => {
    setEditing(item);
    setEditForm({ name: item.name, color: item.color, colorDark: item.colorDark || item.color });
  };

  const saveEditor = async () => {
    if (!editing) return;
    const name = editForm.name.trim();
    if (!name) {
      toast.error('难度名称不能为空');
      return;
    }
    try {
      await api.put(`/api/admin/difficulties/${editing.id}`, {
        name,
        color: editForm.color || '#52c41a',
        colorDark: editForm.colorDark || editForm.color || '#52c41a',
      });
      toast.success('已保存');
      setEditing(null);
      window.dispatchEvent(new CustomEvent('ogoj:difficulties'));
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const remove = async (item: any) => {
    if (!window.confirm(`删除难度「${item.name}」？（还有题目在用时会删不掉）`)) return;
    try {
      await api.del(`/api/admin/difficulties/${item.id}`);
      toast.success('已删除');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const create = async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error('请填写难度名称');
      return;
    }
    try {
      await api.post('/api/admin/difficulties', {
        name,
        color: form.color,
        colorDark: form.colorDark || form.color,
      });
      toast.success(`难度「${name}」已添加`);
      setCreating(false);
      setForm({ name: '', color: COLOR_PRESETS[9], colorDark: '' });
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '添加失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">难度设置</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            难度名称与颜色都可以自定义；新加的难度接在最后一级，改完立刻全站生效。
          </p>
        </div>
        <button type="button" className="btn-primary !py-1.5 text-xs" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" /> 新增难度
        </button>
      </div>

      <Section title={`共 ${items.length} 个难度等级`}>
        {loading ? (
          <Loading />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((item, index) => (
              <div key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="w-6 text-xs text-slate-400">{index + 1}</span>
                <DifficultyBadge value={item.value} />
                <span className="text-xs text-slate-400">题目数据里记的值：{item.value}</span>
                <div className="ml-auto flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-xs text-slate-400">
                    浅色
                    <ColorPicker
                      value={item.color}
                      title="浅色模式配色"
                      onChange={(color) => void update(item, { color: color || item.color })}
                    />
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-slate-400">
                    深色
                    <ColorPicker
                      value={item.colorDark || item.color}
                      title="深色模式配色"
                      onChange={(color) => void update(item, { colorDark: color || item.color })}
                    />
                  </span>
                  <button
                    type="button"
                    className="text-slate-400 hover:text-primary"
                    title="编辑难度"
                    onClick={() => openEditor(item)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className={classNames('text-rose-500 hover:text-rose-600')}
                    onClick={() => void remove(item)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Modal
        open={Boolean(editing)}
        title="编辑难度"
        onClose={() => setEditing(null)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={() => void saveEditor()}>
              保存
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="难度名称" required>
            <input
              className="input"
              value={editForm.name}
              onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
            />
          </Field>
          <ColorBoard
            label="浅色模式配色"
            value={editForm.color}
            onChange={(color) => setEditForm({ ...editForm, color })}
          />
          <ColorBoard
            label="深色模式配色"
            value={editForm.colorDark}
            onChange={(color) => setEditForm({ ...editForm, colorDark: color })}
          />
          <div className="text-xs text-slate-400">
            预览：
            <span
              className="ml-1 rounded px-1.5 py-0.5 text-xs"
              style={{
                backgroundColor: `${editForm.color || '#52c41a'}22`,
                color: editForm.color || '#52c41a',
              }}
            >
              {editForm.name || '难度'}
            </span>
          </div>
        </div>
      </Modal>

      <Modal
        open={creating}
        title="新增难度"
        onClose={() => setCreating(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={() => void create()}>
              添加
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="难度名称" required hint="例如：省选 / 集训队">
            <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="浅色模式配色">
            <div className="flex items-center gap-2">
              <ColorPicker
                value={form.color}
                title="浅色模式配色"
                onChange={(color) => setForm({ ...form, color: color || form.color })}
              />
              <span className="text-xs text-slate-400">{form.color}</span>
            </div>
          </Field>
          <Field label="深色模式配色" hint="留空则跟随浅色配色">
            <div className="flex items-center gap-2">
              <ColorPicker
                value={form.colorDark || form.color}
                title="深色模式配色"
                onChange={(color) => setForm({ ...form, colorDark: color })}
              />
              <span className="text-xs text-slate-400">{form.colorDark || '跟随浅色'}</span>
            </div>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
