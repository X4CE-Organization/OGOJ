import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LifeBuoy, Send } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Loading, Section } from '../components/ui';
import { useToast } from '../components/Toast';

export default function TicketNew() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    category: 'bug',
    title: '',
    content: '',
    priority: 'normal',
    relatedType: params.get('relatedType') ?? '',
    relatedId: params.get('relatedId') ?? '',
  });

  useEffect(() => {
    api
      .get<any>('/api/tickets/meta')
      .then((data) => {
        setMeta(data);
        if (data.categories?.length) {
          setForm((current) => ({ ...current, category: current.category || data.categories[0].value }));
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const submit = async () => {
    if (!user) {
      toast.error('请先登录');
      navigate('/login');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.post<any>('/api/tickets', {
        ...form,
        relatedId: form.relatedId ? Number(form.relatedId) : undefined,
      });
      toast.success(`工单已提交：${result.ticketNo}`);
      void refresh();
      navigate(`/tickets/${result.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loading />;

  const selected = meta?.categories?.find((item: any) => item.value === form.category);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <LifeBuoy className="h-5 w-5 text-primary" /> 提交工单
        </h1>
        <Link to="/tickets" className="text-xs text-primary hover:underline">
          我的工单 →
        </Link>
      </div>

      {meta?.notice && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          {meta.notice}
        </div>
      )}

      {meta && meta.enabled === false ? (
        <Section title="工单系统已关闭">
          <p className="p-4 text-sm text-slate-500">
            站长暂时关闭了工单提交入口，你可以通过「关于」页面中的联系方式反馈问题。
          </p>
        </Section>
      ) : (
        <Section title="工单内容">
          <div className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="问题分类" required>
                <select
                  className="input"
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                >
                  {(meta?.categories ?? []).map((item: any) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {selected?.description && (
                  <span className="mt-1 block text-xs text-slate-400">{selected.description}</span>
                )}
              </Field>
              {meta?.allowPriority !== false && (
                <Field label="优先级" hint="紧急工单请说明理由，管理员会优先处理">
                  <select
                    className="input"
                    value={form.priority}
                    onChange={(event) => setForm({ ...form, priority: event.target.value })}
                  >
                    <option value="low">低 — 不着急</option>
                    <option value="normal">普通</option>
                    <option value="high">高 — 影响正常使用</option>
                    <option value="urgent">紧急 — 站点不可用 / 数据错误</option>
                  </select>
                </Field>
              )}
            </div>

            <Field label="标题" required hint="一句话描述问题，例如「P1003 第 4 个测试点数据有误」">
              <input
                className="input"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="请填写工单标题"
              />
            </Field>

            <Field label="详细描述" required hint={`支持 Markdown；上限 ${meta?.maxContentKb ?? 8} KB`}>
              <textarea
                className="input min-h-[240px]"
                value={form.content}
                onChange={(event) => setForm({ ...form, content: event.target.value })}
                placeholder={
                  '请描述：\n1. 你做了什么\n2. 期望的结果\n3. 实际的结果\n4. 相关的题目编号 / 提交编号 / 截图链接'
                }
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="关联对象类型" hint="可选，便于管理员快速定位">
                <select
                  className="input"
                  value={form.relatedType}
                  onChange={(event) => setForm({ ...form, relatedType: event.target.value })}
                >
                  <option value="">不关联</option>
                  <option value="problem">题目</option>
                  <option value="submission">提交记录</option>
                  <option value="contest">比赛</option>
                  <option value="discussion">讨论帖</option>
                </select>
              </Field>
              <Field label="关联对象 ID">
                <input
                  className="input"
                  value={form.relatedId}
                  onChange={(event) => setForm({ ...form, relatedId: event.target.value })}
                  placeholder="例如 1001 / 42"
                  disabled={!form.relatedType}
                />
              </Field>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-400">
                提交后会生成工单编号，管理员回复时会通过站内信通知你。
              </span>
              <button type="button" className="btn-primary" disabled={submitting} onClick={submit}>
                <Send className="h-4 w-4" />
                {submitting ? '提交中…' : '提交工单'}
              </button>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
