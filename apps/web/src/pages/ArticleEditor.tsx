import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Loading } from '../components/ui';
import Markdown from '../components/Markdown';
import { useToast } from '../components/Toast';
import ImageUploadField from '../components/ImageUploadField';

export default function ArticleEditor() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({
    title: '',
    summary: '',
    content: '',
    cover: '',
    category: '学习',
    isPublic: true,
  });
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .get<any>(`/api/articles/${id}`)
      .then((data) =>
        setForm({
          title: data.article.title,
          summary: data.article.summary ?? '',
          content: data.article.content ?? '',
          cover: data.article.cover ?? '',
          category: data.article.category ?? '学习',
          isPublic: Boolean(data.article.is_public),
        }),
      )
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [id]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      if (id) {
        await api.put(`/api/articles/${id}`, form);
        toast.success('已保存');
        navigate(`/article/${id}`);
      } else {
        const result = await api.post<{ id: number }>('/api/articles', form);
        toast.success('发布成功');
        navigate(`/article/${result.id}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-lg font-semibold">{id ? '编辑文章' : '写文章'}</h1>
      <div className="card space-y-4 p-5">
        <Field label="标题" required>
          <input
            className="input"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="分类">
            <select
              className="input"
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
            >
              {['学习', '教程', '题解', '生活', '其他'].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
          <Field label="封面图">
            <ImageUploadField
              value={form.cover}
              onChange={(next) => setForm({ ...form, cover: next })}
              category="article"
              hint="建议 16:9 或 3:2 的横向图片"
            />
          </Field>
        </div>
        <Field label="摘要" hint="留空时自动截取正文">
          <input
            className="input"
            value={form.summary}
            onChange={(event) => setForm({ ...form, summary: event.target.value })}
          />
        </Field>
        <Field label="正文（Markdown + LaTeX）" required>
          {preview ? (
            <div className="min-h-[320px] rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <Markdown>{form.content}</Markdown>
            </div>
          ) : (
            <textarea
              className="input min-h-[400px] font-mono"
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
            />
          )}
        </Field>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => setPreview((value) => !value)}>
              {preview ? '继续编辑' : '预览'}
            </button>
            <label className="flex items-center gap-1.5 text-sm text-slate-500">
              <input
                type="checkbox"
                checked={form.isPublic}
                onChange={(event) => setForm({ ...form, isPublic: event.target.checked })}
              />
              公开
            </label>
          </div>
          <button type="button" className="btn-primary" disabled={saving} onClick={save}>
            {saving ? '保存中…' : id ? '保存修改' : '发布文章'}
          </button>
        </div>
      </div>
    </div>
  );
}
