import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Check, ChevronDown, Copy, Heart, Pencil, Play, Plus, RotateCcw, Send, ThumbsUp } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, formatMs, formatMemory, fromNow } from '../lib/format';
import { EmptyState, Loading, Section, StatusText, Tabs, TagBadge, UserLink, Modal, Field } from '../components/ui';
import CodeEditor from '../components/CodeEditor';
import Markdown from '../components/Markdown';
import { useToast } from '../components/Toast';
import { clearDraft, loadDraft, saveDraft } from '../lib/draft';
import BackButton from '../components/BackButton';

function SampleBlock({ index, sample }: { index: number; sample: { input: string; output: string; explanation?: string } }) {
  const [copied, setCopied] = useState<'in' | 'out' | null>(null);
  const copy = async (text: string, kind: 'in' | 'out') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-semibold text-slate-500">输入 #{index + 1}</div>
      <div className="relative">
        <pre className="scrollbar-thin overflow-x-auto rounded-lg bg-slate-50 p-3 font-mono text-[13px] dark:bg-slate-800">
{sample.input}
        </pre>
        <button
          type="button"
          className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
          onClick={() => copy(sample.input, 'in')}
        >
          {copied === 'in' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="mb-1 mt-3 text-xs font-semibold text-slate-500">输出 #{index + 1}</div>
      <div className="relative">
        <pre className="scrollbar-thin overflow-x-auto rounded-lg bg-slate-50 p-3 font-mono text-[13px] dark:bg-slate-800">
{sample.output}
        </pre>
        <button
          type="button"
          className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
          onClick={() => copy(sample.output, 'out')}
        >
          {copied === 'out' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      {sample.explanation ? (
        <div className="mt-2 text-xs text-slate-500">
          <Markdown>{sample.explanation}</Markdown>
        </div>
      ) : null}
    </div>
  );
}

export default function ProblemDetail() {
  const { pid = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, meta, settings } = useAuth();
  const toast = useToast();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(params.get('tab') ?? 'statement');
  const [language, setLanguage] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /** 自测面板：自定义输入、运行结果与开关状态 */
  const [testOpen, setTestOpen] = useState(false);
  const [testInput, setTestInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testError, setTestError] = useState('');
  /** 代码来源提示：draft = 上次没提交的草稿，last = 上次提交的代码 */
  const [codeSource, setCodeSource] = useState<{ kind: 'draft' | 'last'; at?: string; id?: number } | null>(
    null,
  );
  /** 编辑器初始内容（模板 / 草稿 / 上次提交），用于判断用户是否真的改过代码 */
  const baseline = useRef('');
  const edited = useRef(false);
  const initializedFor = useRef<number | null>(null);
  const [solutions, setSolutions] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [discussions, setDiscussions] = useState<any[]>([]);
  const [statistics, setStatistics] = useState<any>(null);
  const [stats, setStats] = useState<{ total: number; page: number; size: number }>({ total: 0, page: 1, size: 20 });
  const [statusFilter, setStatusFilter] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [newSolution, setNewSolution] = useState<{ open: boolean; title: string; content: string }>({
    open: false,
    title: '',
    content: '',
  });
  const [newPost, setNewPost] = useState<{ open: boolean; title: string; content: string }>({
    open: false,
    title: '',
    content: '',
  });

  const languages = useMemo(
    () => (meta?.languages ?? []).filter((item) => item.enabled),
    [meta],
  );
  const contestId = params.get('contestId');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(`/api/problems/${encodeURIComponent(pid)}`);
      setData(result);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 进入题目时自动回填代码（每道题只初始化一次），优先级：
   *   1. 浏览器里保存的草稿（正在写、还没提交）
   *   2. 你在这道题上最后一次提交的代码
   *   3. 语言的默认模板
   */
  useEffect(() => {
    if (!data || !languages.length) return undefined;
    const problemId = data.problem.id;
    if (initializedFor.current === problemId) return undefined;
    initializedFor.current = problemId;
    edited.current = false;

    const allowed: string[] = data.problem.allowLanguages ?? [];
    const available = allowed.length ? languages.filter((item) => allowed.includes(item.id)) : languages;
    const preferred = available.find((item) => item.id === 'cpp') ?? available[0];
    if (!preferred) return undefined;
    const pickLanguage = (wanted: string) =>
      available.find((item) => item.id === wanted) ? wanted : preferred.id;

    const draft = loadDraft(user?.id ?? null, problemId);
    if (draft) {
      setLanguage(pickLanguage(draft.language));
      setCode(draft.code);
      baseline.current = draft.code;
      setCodeSource({ kind: 'draft', at: new Date(draft.updatedAt).toISOString() });
      return undefined;
    }

    const template = preferred.template || '';
    setLanguage(preferred.id);
    setCode(template);
    baseline.current = template;
    if (!user) return undefined;

    api
      .get<{ submission: any }>(`/api/problems/${problemId}/last-code`)
      .then((result) => {
        // 期间切换了题目就丢弃结果
        if (initializedFor.current !== problemId || edited.current) return;
        const past = result.submission;
        if (!past?.code) return;
        setLanguage(pickLanguage(past.language));
        setCode(past.code);
        baseline.current = past.code;
        setCodeSource({ kind: 'last', at: past.createdAt, id: past.id });
      })
      .catch(() => undefined);
    return undefined;
  }, [data, languages, user]);

  // 边写边存草稿（防抖）：内容与初始值相同就不存，避免把模板本身存成草稿
  useEffect(() => {
    if (!data || !language || !code.trim()) return undefined;
    const problemId = data.problem.id;
    const timer = setTimeout(() => {
      if (code === baseline.current) {
        if (edited.current) clearDraft(user?.id ?? null, problemId);
        return;
      }
      edited.current = true;
      saveDraft(user?.id ?? null, problemId, { code, language });
    }, 500);
    return () => clearTimeout(timer);
  }, [code, language, data, user]);

  useEffect(() => {
    if (!data) return undefined;
    const problemId = data.problem.id;
    if (tab === 'solutions') {
      api.get<any>(`/api/problems/${problemId}/solutions`).then((result) => setSolutions(result.items ?? []));
    }
    if (tab === 'records') {
      api
        .get<any>(
          `/api/problems/${problemId}/submissions${query({
            page: stats.page,
            size: 20,
            status: statusFilter,
            mine: onlyMine ? 'true' : '',
          })}`,
        )
        .then((result) => {
          setSubmissions(result.items ?? []);
          setStats({ total: result.total ?? 0, page: result.page ?? 1, size: result.size ?? 20 });
        });
    }
    if (tab === 'discussions') {
      api
        .get<any>(`/api/discussions${query({ problemId, size: 20 })}`)
        .then((result) => setDiscussions(result.items ?? []));
    }
    if (tab === 'statistics') {
      api.get<any>(`/api/problems/${problemId}/statistics`).then(setStatistics);
    }
    return undefined;
  }, [tab, data, stats.page, statusFilter, onlyMine]);

  const changeTab = (next: string) => {
    setTab(next);
    const search = new URLSearchParams(params);
    search.set('tab', next);
    setParams(search, { replace: true });
  };

  const submit = async () => {
    if (!user) {
      toast.error('请先登录');
      navigate('/login');
      return;
    }
    if (!code.trim()) {
      toast.error('代码不能为空');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.post<{ id: number }>('/api/submissions', {
        problemId: data.problem.id,
        language,
        code,
        contestId: contestId ? Number(contestId) : undefined,
      });
      toast.success(`提交成功，编号 #${result.id}`);
      clearDraft(user.id, data.problem.id);
      navigate(`/record/${result.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  /** 自测：把当前代码和自定义输入交给后端跑一遍，只拿运行结果 */
  const runTest = async () => {
    if (!user) {
      toast.error('请先登录');
      return;
    }
    setTesting(true);
    setTestError('');
    try {
      const result = await api.post<any>('/api/run', {
        problemId: data.problem.id,
        language,
        code,
        input: testInput,
      });
      setTestResult(result.result);
    } catch (err) {
      setTestResult(null);
      setTestError(err instanceof Error ? err.message : '自测失败');
    } finally {
      setTesting(false);
    }
  };

  const toggleFavorite = async () => {
    if (!user) {
      toast.error('请先登录');
      return;
    }
    try {
      const result = await api.post<{ favorite: boolean }>(`/api/problems/${data.problem.id}/favorite`);
      setData({ ...data, myFavorite: result.favorite });
      toast.success(result.favorite ? '已收藏' : '已取消收藏');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const voteDifficulty = async (score: number) => {
    if (!user) {
      toast.error('请先登录');
      return;
    }
    try {
      await api.post(`/api/problems/${data.problem.id}/vote`, { score });
      toast.success('感谢你的难度投票');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '投票失败');
    }
  };

  const createSolution = async () => {
    try {
      const result = await api.post<{ id: number; pending: boolean }>('/api/solutions', {
        problemId: data.problem.id,
        title: newSolution.title,
        content: newSolution.content,
      });
      toast.success(result.pending ? '题解已提交，等待管理员审核' : '题解发布成功');
      setNewSolution({ open: false, title: '', content: '' });
      changeTab('solutions');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发布失败');
    }
  };

  const createPost = async () => {
    try {
      const result = await api.post<{ id: number }>('/api/discussions', {
        title: newPost.title,
        content: newPost.content,
        problemId: data.problem.id,
        board: 'help',
      });
      toast.success('讨论已发布');
      setNewPost({ open: false, title: '', content: '' });
      navigate(`/discussion/${result.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发布失败');
    }
  };

  if (loading) return <Loading />;
  if (error || !data) return <EmptyState title="无法打开题目" description={error} />;

  const problem = data.problem;
  const canSubmit = settings.allow_submit !== false;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="lg:col-span-2">
        <BackButton label="返回题库" listKey="problems" fallback="/problems" />
      </div>
      <div className="space-y-4">
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div>
              <h1 className="text-lg font-semibold">
                <span className="mr-2 font-mono text-sm text-slate-400">{problem.pid}</span>
                {problem.title}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span
                  className="rounded px-1.5 py-0.5 text-xs [background-color:color-mix(in_srgb,var(--difficulty)_16%,transparent)] [color:color-mix(in_srgb,var(--difficulty)_72%,black)] dark:[background-color:color-mix(in_srgb,var(--difficulty-dark)_18%,transparent)] dark:[color:var(--difficulty-dark)]"
                  style={{
                    ['--difficulty' as string]: problem.difficultyColor,
                    ['--difficulty-dark' as string]: problem.difficultyColorDark ?? problem.difficultyColor,
                  }}
                >
                  {problem.difficultyName}
                </span>
                {settings.show_problem_tags !== false &&
                  problem.tags.map((tag: any) => <TagBadge key={tag.id} tag={tag} />)}
                {problem.provider && settings.show_problem_source !== false && (
                  <span className="text-xs text-slate-400">来源：{problem.provider}</span>
                )}
              </div>
            </div>
            {data.canEdit && (
              <Link to={`/admin/problems/${problem.id}/edit`} className="btn-ghost !px-2.5 !py-1 text-xs">
                <Pencil className="h-3.5 w-3.5" /> 编辑题目
              </Link>
            )}
          </div>

          <Tabs
            active={tab}
            onChange={changeTab}
            tabs={[
              { key: 'statement', label: '题目描述' },
              { key: 'solutions', label: '题解', badge: solutions.length || undefined },
              { key: 'records', label: '评测记录' },
              { key: 'discussions', label: '讨论' },
              { key: 'statistics', label: '统计' },
            ]}
          />

          <div className="p-5">
            {tab === 'statement' && (
              <div>
                {problem.background && (
                  <div className="mb-4 rounded-lg border-l-4 border-primary/40 bg-primary/5 p-3">
                    <Markdown>{problem.background}</Markdown>
                  </div>
                )}
                <Markdown>{problem.statement}</Markdown>
                {problem.inputFormat && (
                  <>
                    <h3 className="mb-1 mt-5 text-base font-semibold">输入格式</h3>
                    <Markdown>{problem.inputFormat}</Markdown>
                  </>
                )}
                {problem.outputFormat && (
                  <>
                    <h3 className="mb-1 mt-5 text-base font-semibold">输出格式</h3>
                    <Markdown>{problem.outputFormat}</Markdown>
                  </>
                )}
                {problem.samples?.length > 0 && (
                  <>
                    <h3 className="mb-1 mt-5 text-base font-semibold">样例</h3>
                    {problem.samples.map((sample: any, index: number) => (
                      <SampleBlock key={index} index={index} sample={sample} />
                    ))}
                  </>
                )}
                {problem.hint && (
                  <>
                    <h3 className="mb-1 mt-5 text-base font-semibold">提示</h3>
                    <Markdown>{problem.hint}</Markdown>
                  </>
                )}
                {problem.subtasks?.length > 0 && (
                  <>
                    <h3 className="mb-1 mt-5 text-base font-semibold">子任务</h3>
                    <ul className="text-sm text-slate-600 dark:text-slate-300">
                      {problem.subtasks.map((subtask: any) => (
                        <li key={subtask.id} className="py-0.5">
                          子任务 {subtask.id}：{subtask.score} 分
                          {subtask.cases?.length ? `（测试点 ${subtask.cases.join(', ')}）` : ''}
                          {subtask.method === 'min' ? ' · 全部通过才得分' : ' · 按测试点累加'}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {problem.judgeMode === 'spj' && (
                  <p className="mt-4 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                    本题使用 Special Judge 评测，输出任意满足要求的答案均可能通过。
                  </p>
                )}
                {problem.judgeMode === 'interactive' && (
                  <p className="mt-4 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                    本题为交互题，请通过与交互库的标准输入输出进行交互。
                  </p>
                )}
              </div>
            )}

            {tab === 'solutions' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">共 {solutions.length} 篇题解</span>
                  <button
                    type="button"
                    className="btn-primary !px-2.5 !py-1 text-xs"
                    onClick={() => setNewSolution({ ...newSolution, open: true })}
                  >
                    <Plus className="h-3.5 w-3.5" /> 写题解
                  </button>
                </div>
                {solutions.length === 0 ? (
                  <EmptyState title="还没有题解" description="通过本题后即可发布你的第一篇题解" />
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {solutions.map((solution) => (
                      <li key={solution.id} className="flex items-center gap-3 py-3">
                        <UserLink user={{ username: solution.username, display_name: solution.display_name, avatar: solution.avatar }} size={26} />
                        <Link to={`/solution/${solution.id}`} className="flex-1 truncate hover:text-primary">
                          {solution.title}
                        </Link>
                        {!solution.is_public && (
                          <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                            审核中
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <ThumbsUp className="h-3 w-3" /> {solution.upvotes}
                        </span>
                        <span className="hidden text-xs text-slate-400 sm:block">{fromNow(solution.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {tab === 'records' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select className="input !w-40" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="">全部结果</option>
                    {['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE'].map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  {user && (
                    <label className="flex items-center gap-1.5 text-sm text-slate-500">
                      <input type="checkbox" checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} />
                      只看我的
                    </label>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th className="w-20">编号</th>
                        <th className="w-40">用户</th>
                        <th className="w-36">结果</th>
                        <th className="w-20">语言</th>
                        <th className="w-24">时间</th>
                        <th className="w-24">内存</th>
                        <th className="w-32">提交时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map((submission) => (
                        <tr key={submission.id}>
                          <td>
                            <Link to={`/record/${submission.id}`} className="link font-mono text-xs">
                              #{submission.id}
                            </Link>
                          </td>
                          <td>
                            <UserLink user={submission.user} size={22} />
                          </td>
                          <td>
                            <StatusText status={submission.status} score={submission.score} />
                          </td>
                          <td className="text-xs uppercase text-slate-500">{submission.language}</td>
                          <td className="text-xs text-slate-500">{formatMs(submission.timeMs)}</td>
                          <td className="text-xs text-slate-500">{formatMemory(submission.memoryKb)}</td>
                          <td className="text-xs text-slate-400">{fromNow(submission.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {submissions.length === 0 && <EmptyState title="暂无评测记录" />}
              </div>
            )}

            {tab === 'discussions' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">共 {discussions.length} 个讨论</span>
                  <button
                    type="button"
                    className="btn-primary !px-2.5 !py-1 text-xs"
                    onClick={() => setNewPost({ ...newPost, open: true })}
                  >
                    <Plus className="h-3.5 w-3.5" /> 发起讨论
                  </button>
                </div>
                {discussions.length === 0 ? (
                  <EmptyState title="还没有相关讨论" />
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {discussions.map((discussion) => (
                      <li key={discussion.id} className="flex items-center gap-3 py-3">
                        <UserLink user={discussion.author} size={26} />
                        <Link to={`/discussion/${discussion.id}`} className="flex-1 truncate hover:text-primary">
                          {discussion.title}
                        </Link>
                        <span className="text-xs text-slate-400">{discussion.replyCount} 回复</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {tab === 'statistics' && statistics && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold">评测结果分布</h3>
                  <ul className="space-y-1 text-sm">
                    {statistics.statuses.map((item: any) => (
                      <li key={item.status} className="flex items-center justify-between">
                        <StatusText status={item.status} />
                        <span className="text-slate-500">{item.c}</span>
                      </li>
                    ))}
                    {!statistics.statuses.length && <li className="text-slate-400">暂无数据</li>}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">语言分布</h3>
                  <ul className="space-y-1 text-sm">
                    {statistics.languages.map((item: any) => (
                      <li key={item.language} className="flex items-center justify-between">
                        <span className="uppercase text-slate-600 dark:text-slate-300">{item.language}</span>
                        <span className="text-slate-500">{item.c}</span>
                      </li>
                    ))}
                    {!statistics.languages.length && <li className="text-slate-400">暂无数据</li>}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div className="card p-4">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <Send className="h-4 w-4 text-primary" /> 提交代码
          </h2>
          {!canSubmit ? (
            <p className="text-sm text-slate-500">本站暂时关闭了代码提交。</p>
          ) : (
            <>
              <div className="mb-2 flex gap-2">
                <select
                  className="input"
                  value={language}
                  onChange={(event) => {
                    setLanguage(event.target.value);
                    const template = languages.find((item) => item.id === event.target.value)?.template;
                    if (template && !code.trim()) setCode(template);
                  }}
                >
                  {languages.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <CodeEditor
                value={code}
                onChange={setCode}
                language={languages.find((item) => item.id === language)?.editor ?? 'cpp'}
                height="300px"
              />
              {codeSource && (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-sky-50 px-2.5 py-1.5 text-xs text-sky-800 dark:bg-sky-500/10 dark:text-sky-200">
                  <span className="min-w-0 flex-1">
                    {codeSource.kind === 'draft'
                      ? `已恢复你上次未提交的草稿${codeSource.at ? `（${fromNow(codeSource.at)}）` : ''}`
                      : `已载入你上次提交的代码${codeSource.id ? ` #${codeSource.id}` : ''}${
                          codeSource.at ? `（${fromNow(codeSource.at)}）` : ''
                        }`}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 underline decoration-dotted hover:text-sky-600"
                    onClick={() => {
                      if (!data) return;
                      clearDraft(user?.id ?? null, data.problem.id);
                      const template = languages.find((item) => item.id === language)?.template ?? '';
                      setCode(template);
                      baseline.current = template;
                      edited.current = false;
                      setCodeSource(null);
                    }}
                  >
                    清空
                  </button>
                </div>
              )}

              {/* ------------------------------------------------------- 自测 */}
              <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300"
                  onClick={() => setTestOpen((open) => !open)}
                >
                  <span className="flex items-center gap-1.5">
                    <Play className="h-3.5 w-3.5 text-primary" /> 自测（自定义输入）
                  </span>
                  <ChevronDown className={classNames('h-3.5 w-3.5 transition-transform', testOpen && 'rotate-180')} />
                </button>

                {testOpen && (
                  <div className="space-y-2 border-t border-slate-200 px-3 py-3 dark:border-slate-700">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>自定义输入</span>
                      <div className="flex items-center gap-2">
                        {problem.samples?.length > 0 && (
                          <button
                            type="button"
                            className="hover:text-primary"
                            onClick={() => {
                              setTestInput(problem.samples[0].input ?? '');
                              setTestResult(null);
                            }}
                          >
                            填入样例 1
                          </button>
                        )}
                        <button
                          type="button"
                          className="inline-flex items-center gap-0.5 hover:text-primary"
                          onClick={() => {
                            setTestInput('');
                            setTestResult(null);
                            setTestError('');
                          }}
                        >
                          <RotateCcw className="h-3 w-3" /> 清空
                        </button>
                      </div>
                    </div>
                    <textarea
                      className="input min-h-[90px] w-full font-mono text-xs"
                      placeholder="在这里输入自测数据，运行时会作为标准输入传给程序"
                      value={testInput}
                      spellCheck={false}
                      onChange={(event) => {
                        setTestInput(event.target.value);
                        setTestResult(null);
                      }}
                    />
                    <button
                      type="button"
                      className="btn-primary w-full !py-1.5 text-xs"
                      disabled={testing}
                      onClick={() => void runTest()}
                    >
                      <Play className="h-3.5 w-3.5" /> {testing ? '运行中…' : '运行自测'}
                    </button>

                    {testError && <p className="text-xs text-rose-500">{testError}</p>}

                    {testResult && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <StatusText status={testResult.status} />
                          <span className="text-slate-400">{testResult.message}</span>
                          {testResult.status !== 'CE' && testResult.status !== 'SE' && (
                            <span className="text-slate-400">
                              {formatMs(testResult.timeMs)} · {formatMemory(testResult.memoryKb)}
                            </span>
                          )}
                        </div>
                        {testResult.compileOutput && (
                          <div>
                            <div className="mb-1 text-[11px] text-slate-400">编译输出</div>
                            <pre className="scrollbar-thin max-h-40 overflow-auto rounded-lg bg-slate-900 p-2 font-mono text-[11px] text-rose-200">
{testResult.compileOutput}
                            </pre>
                          </div>
                        )}
                        {!testResult.compileOutput && (
                          <div>
                            <div className="mb-1 text-[11px] text-slate-400">输出</div>
                            <pre className="scrollbar-thin max-h-60 overflow-auto rounded-lg bg-slate-900 p-2 font-mono text-[11px] text-slate-100">
{testResult.stdout?.trim() ? testResult.stdout : '（没有输出）'}
                            </pre>
                          </div>
                        )}
                        {testResult.stderr && (
                          <div>
                            <div className="mb-1 text-[11px] text-slate-400">错误输出</div>
                            <pre className="scrollbar-thin max-h-40 overflow-auto rounded-lg bg-slate-900 p-2 font-mono text-[11px] text-amber-200">
{testResult.stderr}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                <span>{code.length} 字符</span>
                {user && (
                  <span>
                    我的记录：{data.myStats.accepted > 0 ? '已通过' : data.myStats.attempts > 0 ? '未通过' : '未提交'}
                  </span>
                )}
              </div>
              <button type="button" className="btn-primary mt-3 w-full" disabled={submitting} onClick={submit}>
                {submitting ? '提交中…' : '提交评测'}
              </button>
            </>
          )}
        </div>

        <div className="card p-4 text-sm">
          <h2 className="mb-3 text-sm font-semibold">题目信息</h2>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500">时间限制</dt>
              <dd>{problem.timeLimit} ms</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">内存限制</dt>
              <dd>{problem.memoryLimit} MB</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">评测方式</dt>
              <dd>{problem.judgeMode === 'spj' ? 'Special Judge' : problem.judgeMode === 'interactive' ? '交互题' : '标准比对'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">测试点</dt>
              <dd>{problem.testcaseCount} 个</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">通过 / 提交</dt>
              <dd>
                {problem.acceptedCount} / {problem.submitCount}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">更新时间</dt>
              <dd>{fromNow(problem.updatedAt)}</dd>
            </div>
          </dl>

          <Link
            to={`/tickets/new?relatedType=problem&relatedId=${problem.id}`}
            className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 hover:text-primary"
          >
            ⚑ 题目数据有误 / 想反馈问题？提交工单
          </Link>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={toggleFavorite}
              className={classNames(
                'btn-ghost flex-1 !py-1.5 text-xs',
                data.myFavorite ? '!text-rose-500' : '',
              )}
            >
              <Heart className={classNames('h-3.5 w-3.5', data.myFavorite ? 'fill-rose-500' : '')} />
              {data.myFavorite ? '已收藏' : '收藏'}
            </button>
            {user?.role !== 'user' && (
              <a href={`/api/problems/${problem.id}/testdata.zip`} className="btn-ghost flex-1 !py-1.5 text-xs">
                下载数据
              </a>
            )}
          </div>

          {settings.enable_difficulty_vote !== false && (
            <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
                <span>难度投票</span>
                <span>
                  {data.difficultyVote.average ? `平均 ${data.difficultyVote.average}（${data.difficultyVote.count} 人）` : '暂无投票'}
                </span>
              </div>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5, 6, 7].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => voteDifficulty(value)}
                    className="flex-1 rounded bg-slate-100 py-1 text-xs text-slate-500 hover:bg-primary hover:text-white dark:bg-slate-800"
                    title={`难度 ${value}`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {data.contestLinks?.length > 0 && (
          <Section title="相关比赛">
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {data.contestLinks.map((contest: any) => (
                <li key={contest.id} className="px-4 py-2.5">
                  <Link to={`/contest/${contest.id}`} className="hover:text-primary">
                    {contest.title}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </aside>

      <Modal
        open={newSolution.open}
        title="发布题解"
        onClose={() => setNewSolution({ ...newSolution, open: false })}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setNewSolution({ ...newSolution, open: false })}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={createSolution}>
              发布
            </button>
          </>
        }
        width="max-w-3xl"
      >
        <div className="space-y-3">
          <Field label="标题" required>
            <input
              className="input"
              value={newSolution.title}
              onChange={(event) => setNewSolution({ ...newSolution, title: event.target.value })}
              placeholder="例如：动态规划 O(n) 做法"
            />
          </Field>
          <Field label="内容（支持 Markdown 与 LaTeX）" required>
            <textarea
              className="input min-h-[280px] font-mono"
              value={newSolution.content}
              onChange={(event) => setNewSolution({ ...newSolution, content: event.target.value })}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={newPost.open}
        title="发起讨论"
        onClose={() => setNewPost({ ...newPost, open: false })}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setNewPost({ ...newPost, open: false })}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={createPost}>
              发布
            </button>
          </>
        }
        width="max-w-2xl"
      >
        <div className="space-y-3">
          <Field label="标题" required>
            <input
              className="input"
              value={newPost.title}
              onChange={(event) => setNewPost({ ...newPost, title: event.target.value })}
            />
          </Field>
          <Field label="内容" required>
            <textarea
              className="input min-h-[200px]"
              value={newPost.content}
              onChange={(event) => setNewPost({ ...newPost, content: event.target.value })}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
