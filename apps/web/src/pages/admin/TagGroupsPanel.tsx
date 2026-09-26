import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { classNames } from '../../lib/format';
import { EmptyState, Field, Loading, Modal, Section } from '../../components/ui';
import { COLOR_PRESETS, ColorBoard } from '../../components/ColorPicker';
import { useToast } from '../../components/Toast';

const DEFAULT_GROUP = '默认';
const PRESET_COLORS = COLOR_PRESETS;

export default function TagGroupsPanel() {
  const toast = useToast();
  const [tags, setTags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', group: DEFAULT_GROUP, color: PRESET_COLORS[0] });
  const [renameFrom, setRenameFrom] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState('');
  /** 点铅笔打开的编辑弹窗：上面改名字，下面颜色板 */
  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: '', color: '', group: DEFAULT_GROUP });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ tags: any[] }>('/api/tags');
      setTags(data.tags ?? []);
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

  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const tag of tags) {
      const key = String(tag.category || DEFAULT_GROUP);
      map.set(key, [...(map.get(key) ?? []), tag]);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === DEFAULT_GROUP) return -1;
      if (b === DEFAULT_GROUP) return 1;
      return a.localeCompare(b);
    });
  }, [tags]);

  const createTag = async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error('请填写标签名称');
      return;
    }
    try {
      await api.post('/api/tags', { name, category: form.group.trim() || DEFAULT_GROUP, color: form.color });
      toast.success(`标签「${name}」已创建`);
      setCreating(false);
      setForm({ name: '', group: form.group, color: PRESET_COLORS[0] });
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    }
  };

  const openEditor = (tag: any, group: string) => {
    setEditing(tag);
    setEditForm({ name: tag.name, color: tag.color || '#60a5fa', group });
  };

  const saveTag = async () => {
    if (!editing) return;
    const name = editForm.name.trim();
    if (!name) {
      toast.error('标签名称不能为空');
      return;
    }
    try {
      await api.put(`/api/tags/${editing.id}`, {
        name,
        color: editForm.color || '#60a5fa',
        category: editForm.group.trim() || DEFAULT_GROUP,
      });
      toast.success('标签已保存');
      setEditing(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const moveTag = async (tag: any, group: string) => {
    try {
      await api.put(`/api/tags/${tag.id}`, { category: group });
      toast.success(`已移动到「${group}」`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '移动失败');
    }
  };

  const setColor = async (tag: any, color: string) => {
    try {
      await api.put(`/api/tags/${tag.id}`, { color });
      setTags((current) => current.map((item) => (item.id === tag.id ? { ...item, color } : item)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '改色失败');
    }
  };

  const removeTag = async (tag: any) => {
    if (!window.confirm(`确定删除标签「${tag.name}」吗？已加该标签的题目会同步取消这个标签。`)) return;
    try {
      await api.del(`/api/tags/${tag.id}`);
      toast.success('已删除');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const renameGroup = async () => {
    if (!renameFrom) return;
    const to = renameTo.trim();
    if (!to || to === renameFrom) {
      setRenameFrom(null);
      return;
    }
    try {
      const result = await api.put<{ affected: number }>('/api/admin/tag-groups', { from: renameFrom, to });
      toast.success(`分组已改为「${to}」，涉及 ${result.affected ?? 0} 个标签`);
      setRenameFrom(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '修改失败');
    }
  };

  const removeGroup = async (group: string) => {
    if (group === DEFAULT_GROUP) {
      toast.error('默认分组不能删除');
      return;
    }
    if (!window.confirm(`删除分组「${group}」？组内标签会移动到「${DEFAULT_GROUP}」。`)) return;
    try {
      const result = await api.del<{ affected: number }>(
        `/api/admin/tag-groups?name=${encodeURIComponent(group)}&moveTo=${encodeURIComponent(DEFAULT_GROUP)}`,
      );
      toast.success(`分组已删除，${result.affected ?? 0} 个标签移到「${DEFAULT_GROUP}」`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const groupNames = groups.map(([name]) => name);

  const recolorGroup = async (group: string) => {
    if (!window.confirm(`把「${group}」里的标签按名称重新配色？会覆盖这个分组里现有的颜色。`)) return;
    try {
      const result = await api.put<{ affected: number }>('/api/admin/tag-groups/colors', { group });
      toast.success(`已重新配色 ${result.affected ?? 0} 个标签`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '配色失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">标签分组</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            导入题目时自动创建的标签会归到「默认」分组；这里可以新建、改名、删分组，也可以调整标签所属分组。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost !py-1.5 text-xs"
            onClick={() => {
              setRenameFrom(groupNames[0] ?? DEFAULT_GROUP);
              setRenameTo(groupNames[0] ?? DEFAULT_GROUP);
            }}
          >
            <FolderPlus className="h-3.5 w-3.5" /> 重命名分组
          </button>
          <button type="button" className="btn-primary !py-1.5 text-xs" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> 新建标签
          </button>
        </div>
      </div>

      {loading ? (
        <Loading />
      ) : groups.length === 0 ? (
        <div className="card">
          <EmptyState title="还没有标签" description="导入题目或在这里新建标签后，就能按分组管理" />
        </div>
      ) : (
        groups.map(([group, list]) => (
          <Section
            key={group}
            title={
              <span className="flex items-center gap-2">
                {group}
                <span className="text-xs font-normal text-slate-400">{list.length} 个标签</span>
              </span>
            }
            action={
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  className="text-slate-400 hover:text-primary"
                  onClick={() => void recolorGroup(group)}
                >
                  重新配色
                </button>
                <button
                  type="button"
                  className="text-slate-400 hover:text-primary"
                  onClick={() => {
                    setRenameFrom(group);
                    setRenameTo(group);
                  }}
                >
                  改名
                </button>
                {group !== DEFAULT_GROUP && (
                  <button type="button" className="text-rose-500 hover:underline" onClick={() => void removeGroup(group)}>
                    删除分组
                  </button>
                )}
              </div>
            }
          >
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {list.map((tag) => (
                <div key={tag.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                  {/* 颜色只做展示，改颜色请点右侧铅笔 */}
                  <span
                    title={tag.color || '#60a5fa'}
                    className="h-5 w-5 shrink-0 rounded-full border border-slate-200 dark:border-slate-600"
                    style={{ backgroundColor: tag.color || '#60a5fa' }}
                  />
                  <span
                    className="rounded px-1.5 py-0.5 text-xs"
                    style={{ backgroundColor: `${tag.color || '#60a5fa'}22`, color: tag.color || '#60a5fa' }}
                  >
                    {tag.name}
                  </span>
                  <span className="text-xs text-slate-400">{tag.problem_count ?? 0} 道题</span>
                  <div className="ml-auto flex items-center gap-2">
                    <select
                      className="input !w-32 !py-1 text-xs"
                      value={group}
                      onChange={(event) => void moveTag(tag, event.target.value)}
                    >
                      {groupNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="text-slate-400 hover:text-primary"
                      title="编辑标签"
                      onClick={() => openEditor(tag, group)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className="text-rose-500 hover:text-rose-600" onClick={() => void removeTag(tag)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ))
      )}

      <Modal
        open={Boolean(editing)}
        title="编辑标签"
        onClose={() => setEditing(null)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={() => void saveTag()}>
              保存
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="标签名称" required>
            <input
              className="input"
              value={editForm.name}
              onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
            />
          </Field>
          <Field label="所属分组">
            <input
              className="input"
              list="tag-group-options-edit"
              value={editForm.group}
              onChange={(event) => setEditForm({ ...editForm, group: event.target.value })}
            />
            <datalist id="tag-group-options-edit">
              {groupNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <ColorBoard
            label="标签颜色"
            value={editForm.color}
            onChange={(color) => setEditForm({ ...editForm, color })}
          />
          <div className="text-xs text-slate-400">
            预览：
            <span
              className="ml-1 rounded px-1.5 py-0.5"
              style={{
                backgroundColor: `${editForm.color || '#60a5fa'}22`,
                color: editForm.color || '#60a5fa',
              }}
            >
              {editForm.name || '标签'}
            </span>
          </div>
        </div>
      </Modal>

      <Modal
        open={creating}
        title="新建标签"
        onClose={() => setCreating(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={() => void createTag()}>
              创建
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="标签名称" required>
            <input
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="例如：二分查找"
            />
          </Field>
          <Field label="所属分组" hint="可以直接输入新分组名，也可以选择已有分组">
            <input
              className="input"
              list="tag-group-options"
              value={form.group}
              onChange={(event) => setForm({ ...form, group: event.target.value })}
            />
            <datalist id="tag-group-options">
              {groupNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <ColorBoard label="标签颜色" value={form.color} onChange={(color) => setForm({ ...form, color })} />
        </div>
      </Modal>

      <Modal
        open={Boolean(renameFrom)}
        title="重命名分组"
        onClose={() => setRenameFrom(null)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setRenameFrom(null)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={() => void renameGroup()}>
              保存
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="要修改的分组">
            <select className="input" value={renameFrom ?? ''} onChange={(event) => setRenameFrom(event.target.value)}>
              {groupNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="新的分组名称" hint="填一个已有的分组名就相当于把两个分组合并">
            <input className="input" value={renameTo} onChange={(event) => setRenameTo(event.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
