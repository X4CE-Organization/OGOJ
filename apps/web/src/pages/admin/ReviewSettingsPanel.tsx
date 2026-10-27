import { useEffect, useState } from 'react';
import { BookOpen, FileText, ListChecks, MessageSquare, Radio, ShieldCheck, Sparkles, Trophy } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Loading, Section } from '../../components/ui';
import { useToast } from '../../components/Toast';

const ITEMS = [
  {
    key: 'user_problem_need_review',
    title: '用户题目',
    description: '用户新建或修改题目后，审核通过前不会出现在公开题库。',
    icon: BookOpen,
  },
  {
    key: 'user_contest_need_review',
    title: '用户比赛',
    description: '用户创建的比赛审核通过前不会公开，也不会开放报名。',
    icon: Trophy,
  },
  {
    key: 'solution_need_approved',
    title: '题解',
    description: '用户发布或修改题解后，需要管理员审核通过才公开。',
    icon: ListChecks,
  },
  {
    key: 'article_need_review',
    title: '文章',
    description: '文章广场中的用户文章审核通过后才能被其他人看到。',
    icon: FileText,
  },
  {
    key: 'discussion_need_review',
    title: '讨论帖子',
    description: '用户发布或修改帖子后进入待审核状态。',
    icon: MessageSquare,
  },
  {
    key: 'comment_need_review',
    title: '评论与回复',
    description: '题目、文章、题解、比赛、动态和讨论区回复统一进入审核。',
    icon: MessageSquare,
  },
  {
    key: 'moment_need_review',
    title: '动态',
    description: '新动态和作者修改后的动态需要审核通过才进入动态广场。',
    icon: Radio,
  },
  {
    key: 'list_need_review',
    title: '题单',
    description: '用户题单审核通过前不会公开。',
    icon: ListChecks,
  },
  {
    key: 'scratch_need_review',
    title: 'Scratch 作品',
    description: '作品发布后进入待审核列表，通过后才出现在作品中心。',
    icon: Sparkles,
  },
] as const;

export default function ReviewSettingsPanel() {
  const toast = useToast();
  const { refreshMeta } = useAuth();
  const [values, setValues] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<any>('/api/admin/settings')
      .then((data) => {
        setValues(
          Object.fromEntries(ITEMS.map((item) => [item.key, Boolean(data.values[item.key])])),
        );
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '加载审核设置失败'))
      .finally(() => setLoading(false));
  }, [toast]);

  const valueOf = (key: string) => (key in dirty ? dirty[key] : values[key]);

  const save = async () => {
    if (!Object.keys(dirty).length) {
      toast.push('没有需要保存的修改', 'info');
      return;
    }
    setSaving(true);
    try {
      const result = await api.put<any>('/api/admin/settings', { values: dirty });
      setValues((current) => ({ ...current, ...dirty }));
      setDirty({});
      await refreshMeta();
      toast.success(`已保存 ${result.changed?.length ?? 0} 项审核设置`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <ShieldCheck className="h-5 w-5 text-primary" /> 审核设置
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            分别控制每类用户内容是否需要管理员审核。管理员和超级管理员发布的内容始终直接通过。
          </p>
        </div>
        <button
          type="button"
          className="btn-primary !py-1.5 text-xs"
          disabled={saving || !Object.keys(dirty).length}
          onClick={() => void save()}
        >
          {saving ? '保存中…' : `保存设置${Object.keys(dirty).length ? `（${Object.keys(dirty).length}）` : ''}`}
        </button>
      </div>

      <Section title="用户内容审核">
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const enabled = valueOf(item.key);
            return (
              <label
                key={item.key}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 transition hover:border-primary/40 dark:border-slate-700"
              >
                <span className="rounded-lg bg-primary/10 p-2 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.title}</span>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(event) => setDirty((current) => ({ ...current, [item.key]: event.target.checked }))}
                    />
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">{item.description}</span>
                  <span className={`mt-2 inline-flex rounded px-1.5 py-0.5 text-[11px] ${enabled ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'}`}>
                    {enabled ? '需要审核' : '直接发布'}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

