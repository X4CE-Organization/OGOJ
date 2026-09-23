import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { classNames, formatTime } from '../../lib/format';
import { EmptyState, Field, Loading, Modal, Section } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function AnnouncementsPanel() {
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<{ items: any[] }>('/api/admin/announcements');
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

  const save = async () => {
    try {
      const payload = {
        title: form.title,
        content: form.content,
        type: form.type,
        isPinned: Boolean(form.isPinned),
        isPublic: form.isPublic !== false,
      };
      if (editing?.isNew) {
        await api.post('/api/admin/announcements', payload);
        toast.success('公告已发布');
      } else {
        await api.put(`/api/admin/announcements/${editing.id}`, payload);
        toast.success('公告已保存');
      }
      setEditing(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const remove = async (item: any) => {
    if (!window.confirm('确定删除这条公告吗？')) return;
    await api.del(`/api/admin/announcements/${item.id}`);
    toast.success('已删除');
    void load();
  };

  const togglePin = async (item: any) => {
    await api.put(`/api/admin/announcements/${item.id}`, { isPinned: !item.is_pinned });
    void load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">公告管理</h1>
        <button
          type="button"
          className="btn-primary !py-1.5 text-xs"
          onClick={() => {
            setForm({ title: '', content: '', type: 'notice', isPinned: false, isPublic: true });
            setEditing({ isNew: true });
          }}
        >
          <Plus className="h-3.5 w-3.5" /> 发布公告
        </button>
      </div>

      <Section title={`共 ${items.length} 条公告`}>
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title="还没有公告" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {item.is_pinned && <span className="rounded bg-rose-100 px-1 text-xs text-rose-600 dark:bg-rose-500/20">置顶</span>}
                    <span className="font-medium">{item.title}</span>
                    <span className="rounded bg-slate-100 px-1 text-[11px] text-slate-500 dark:bg-slate-800">{item.type}</span>
                    {!item.is_public && <span className="text-[11px] text-amber-500">未公开</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.content}</p>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {item.username ?? '系统'} · {formatTime(item.created_at)} · {item.views} 次浏览
                  </div>
                </div>
                <div className="flex shrink-0 gap-2 text-xs">
                  <button type="button" className="text-slate-500 hover:underline" onClick={() => togglePin(item)}>
                    {item.is_pinned ? '取消置顶' : '置顶'}
                  </button>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      setEditing(item);
                      setForm({
                        title: item.title,
                        content: item.content,
                        type: item.type,
                        isPinned: Boolean(item.is_pinned),
                        isPublic: Boolean(item.is_public),
                      });
                    }}
                  >
                    <Pencil className="inline h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="text-rose-500 hover:underline" onClick={() => remove(item)}>
                    <Trash2 className="inline h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Modal
        open={Boolean(editing)}
        title={editing?.isNew ? '发布公告' : '编辑公告'}
        onClose={() => setEditing(null)}
        width="max-w-2xl"
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
          <Field label="标题" required>
            <input className="input" value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="类型">
            <select className="input" value={form.type ?? 'notice'} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="notice">普通通知</option>
              <option value="important">重要公告</option>
              <option value="update">版本更新</option>
              <option value="contest">比赛相关</option>
            </select>
          </Field>
          <Field label="内容（Markdown）">
            <textarea
              className="input min-h-[200px] font-mono text-xs"
              value={form.content ?? ''}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </Field>
          <div className={classNames('flex flex-wrap gap-4 text-sm text-slate-500')}>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={Boolean(form.isPinned)}
                onChange={(e) => setForm({ ...form, isPinned: e.target.checked })}
              />
              置顶
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={form.isPublic !== false}
                onChange={(e) => setForm({ ...form, isPublic: e.target.checked })}
              />
              公开显示
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}
