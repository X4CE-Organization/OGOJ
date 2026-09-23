import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { EmptyState, Field, Loading, Modal, Section } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function CarouselPanel() {
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<{ items: any[] }>('/api/admin/carousel');
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

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const result = await api.upload<{ url: string }>('/api/upload?category=carousel', file);
      setForm((current: any) => ({ ...current, image: result.url }));
      toast.success('图片已上传');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    try {
      if (editing?.isNew) {
        await api.post('/api/admin/carousel', form);
        toast.success('已添加轮播图');
      } else {
        await api.put(`/api/admin/carousel/${editing.id}`, form);
        toast.success('已保存');
      }
      setEditing(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const remove = async (item: any) => {
    if (!window.confirm('确定删除这张轮播图吗？')) return;
    await api.del(`/api/admin/carousel/${item.id}`);
    toast.success('已删除');
    void load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">首页轮播图</h1>
        <button
          type="button"
          className="btn-primary !py-1.5 text-xs"
          onClick={() => {
            setForm({ title: '', subtitle: '', image: '', link: '', sort: items.length + 1, isActive: true });
            setEditing({ isNew: true });
          }}
        >
          <Plus className="h-3.5 w-3.5" /> 添加轮播图
        </button>
      </div>

      <Section title={`共 ${items.length} 张`}>
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title="还没有轮播图" description="上传图片后首页会显示轮播" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-4 p-4">
                {item.image ? (
                  <img src={item.image} alt={item.title} className="h-16 w-28 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-16 w-28 items-center justify-center rounded-lg bg-gradient-to-r from-sky-400 to-indigo-500 text-xs text-white">
                    渐变背景
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{item.title || '(无标题)'}</div>
                  <div className="truncate text-xs text-slate-500">{item.subtitle}</div>
                  <div className="text-[11px] text-slate-400">
                    排序 {item.sort} · 链接 {item.link || '无'} ·{' '}
                    {item.is_active ? <span className="text-emerald-600">已启用</span> : <span className="text-slate-400">已停用</span>}
                  </div>
                </div>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      setEditing(item);
                      setForm({ ...item, isActive: Boolean(item.is_active) });
                    }}
                  >
                    <Pencil className="mr-0.5 inline h-3.5 w-3.5" />
                    编辑
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

      <Section title="说明">
        <p className="p-4 text-xs text-slate-500">
          轮播图显示在首页顶部。未上传图片时会使用主题渐变背景，只显示标题与副标题。链接可以是站内路径（如 <code>/problems</code>）或外部地址。
        </p>
      </Section>

      <Modal
        open={Boolean(editing)}
        title={editing?.isNew ? '添加轮播图' : '编辑轮播图'}
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
          <Field label="标题">
            <input className="input" value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="副标题">
            <input className="input" value={form.subtitle ?? ''} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} />
          </Field>
          <Field label="图片" hint="留空则显示渐变背景">
            <div className="flex items-center gap-2">
              <input
                className="input"
                value={form.image ?? ''}
                onChange={(e) => setForm({ ...form, image: e.target.value })}
                placeholder="/uploads/carousel/xxx.png"
              />
              <label className="btn-ghost cursor-pointer !py-2 text-xs">
                <Upload className="h-3.5 w-3.5" />
                {uploading ? '上传中' : '上传'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                    event.target.value = '';
                  }}
                />
              </label>
            </div>
          </Field>
          <Field label="跳转链接">
            <input className="input" value={form.link ?? ''} onChange={(e) => setForm({ ...form, link: e.target.value })} />
          </Field>
          <Field label="排序">
            <input
              className="input"
              type="number"
              value={form.sort ?? 0}
              onChange={(e) => setForm({ ...form, sort: Number(e.target.value) })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={Boolean(form.isActive)}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            启用
          </label>
        </div>
      </Modal>
    </div>
  );
}
