import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Download, Pencil, Trash2, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { classNames, formatBytes, fromNow } from '../../lib/format';
import { EmptyState, Field, Loading, Modal, UserLink } from '../../components/ui';
import { useToast } from '../../components/Toast';
import type { TeamContextValue } from './TeamLayout';

export default function TeamFiles() {
  const ctx = useOutletContext<TeamContextValue>();
  const { user } = useAuth();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', description: '', isPublic: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<any>(`/api/teams/${ctx.team.slug}/files`));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ctx.team.slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`/api/teams/${ctx.team.slug}/files`, {
        method: 'POST',
        body: form,
        credentials: 'include',
        headers: localStorage.getItem('ogoj-token')
          ? { Authorization: `Bearer ${localStorage.getItem('ogoj-token')}` }
          : undefined,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.message ?? '上传失败');
      toast.success('文件已上传');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const save = async () => {
    if (!editing) return;
    try {
      await api.put(`/api/teams/${ctx.team.slug}/files/${editing.id}`, form);
      toast.success('已保存');
      setEditing(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const remove = async (file: any) => {
    if (!window.confirm(`确定删除文件「${file.name}」吗？`)) return;
    await api.del(`/api/teams/${ctx.team.slug}/files/${file.id}`);
    toast.success('已删除');
    void load();
  };

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <span className="text-sm text-slate-500">
          共 {data?.items?.length ?? 0} 个文件 · 可上传讲义、题面、测试数据包等
        </span>
        {data?.canUpload && (
          <>
            <button
              type="button"
              className="btn-primary ml-auto !py-1.5 text-xs"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" /> {uploading ? '上传中…' : '上传文件'}
            </button>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </>
        )}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="团队文件库为空" description="把常用资料传上来，队友随时可以下载" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>文件</th>
                  <th className="w-24">大小</th>
                  <th className="w-32">上传者</th>
                  <th className="w-24">下载</th>
                  <th className="w-28">可见性</th>
                  <th className="w-32">时间</th>
                  <th className="w-40">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((file: any) => (
                  <tr key={file.id}>
                    <td>
                      <div className="font-medium">{file.name}</div>
                      {file.description && <div className="text-[11px] text-slate-400">{file.description}</div>}
                    </td>
                    <td className="text-xs text-slate-500">{formatBytes(file.size)}</td>
                    <td className="text-xs">
                      <UserLink
                        user={{
                          id: file.uploader_id,
                          username: file.uploader_name,
                          display_name: file.uploader_display,
                          avatar: file.uploader_avatar,
                        }}
                        size={20}
                      />
                    </td>
                    <td className="text-xs text-slate-500">{file.downloads}</td>
                    <td>
                      <span
                        className={classNames(
                          'rounded px-1.5 py-0.5 text-xs',
                          file.is_public
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-500 dark:bg-slate-800',
                        )}
                      >
                        {file.is_public ? '公开' : '仅团队'}
                      </span>
                    </td>
                    <td className="text-xs text-slate-400">{fromNow(file.created_at)}</td>
                    <td>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <a
                          href={`/api/teams/${ctx.team.slug}/files/${file.id}`}
                          className="text-primary hover:underline"
                        >
                          <Download className="mr-0.5 inline h-3.5 w-3.5" /> 下载
                        </a>
                        {(data.canManage || file.uploader_id === user?.id) && (
                          <>
                            <button
                              type="button"
                              className="text-slate-500 hover:underline"
                              onClick={() => {
                                setEditing(file);
                                setForm({
                                  name: file.name,
                                  description: file.description ?? '',
                                  isPublic: Boolean(file.is_public),
                                });
                              }}
                            >
                              <Pencil className="inline h-3.5 w-3.5" />
                            </button>
                            <button type="button" className="text-rose-500 hover:underline" onClick={() => remove(file)}>
                              <Trash2 className="inline h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={Boolean(editing)}
        title="编辑文件信息"
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
          <Field label="显示名称">
            <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="说明">
            <input
              className="input"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(event) => setForm({ ...form, isPublic: event.target.checked })}
            />
            对非成员公开下载
          </label>
        </div>
      </Modal>
    </div>
  );
}
