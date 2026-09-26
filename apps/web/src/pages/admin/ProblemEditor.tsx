import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, RefreshCw, Save, Trash2, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { classNames, difficultyList, formatBytes } from '../../lib/format';
import { EmptyState, Field, Loading, Modal, Section, Tabs } from '../../components/ui';
import CodeEditor from '../../components/CodeEditor';
import Markdown from '../../components/Markdown';
import { useToast } from '../../components/Toast';

interface Sample {
  input: string;
  output: string;
  explanation?: string;
}

interface Subtask {
  id: number;
  score: number;
  cases?: number[];
  method?: 'min' | 'sum';
  deps?: number[];
}

export default function ProblemEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { meta } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('basic');
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({
    pid: '',
    title: '',
    background: '',
    statement: '',
    inputFormat: '',
    outputFormat: '',
    hint: '',
    difficulty: 1,
    provider: '',
    timeLimit: 1000,
    memoryLimit: 256,
    judgeMode: 'standard',
    compareMode: '',
    spjLanguage: 'cpp',
    spjCode: '',
    interCode: '',
    allowLanguages: [],
    samples: [] as Sample[],
    subtasks: [] as Subtask[],
    tags: '',
    isPublic: true,
    isContestOnly: false,
    reviewStatus: 'approved',
  });
  const [testcases, setTestcases] = useState<any[]>([]);
  const [caseModal, setCaseModal] = useState<any>(null);
  const [preview, setPreview] = useState(false);

  const loadTestcases = useCallback(async (problemId: string | number) => {
    try {
      const result = await api.get<{ items: any[] }>(`/api/problems/${problemId}/testcases`);
      setTestcases(result.items);
    } catch {
      setTestcases([]);
    }
  }, []);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    api
      .get<any>(`/api/problems/${id}`)
      .then((data) => {
        const problem = data.problem;
        setForm({
          pid: problem.pid,
          title: problem.title,
          background: problem.background ?? '',
          statement: problem.statement ?? '',
          inputFormat: problem.inputFormat ?? '',
          outputFormat: problem.outputFormat ?? '',
          hint: problem.hint ?? '',
          difficulty: problem.difficulty,
          provider: problem.provider ?? '',
          timeLimit: problem.timeLimit,
          memoryLimit: problem.memoryLimit,
          judgeMode: problem.judgeMode,
          compareMode: problem.compareMode ?? '',
          spjLanguage: data.spj?.language || problem.spjLanguage || 'cpp',
          spjCode: data.spj?.code ?? '',
          interCode: '',
          allowLanguages: problem.allowLanguages ?? [],
          samples: problem.samples ?? [],
          subtasks: problem.subtasks ?? [],
          tags: (problem.tags ?? []).map((tag: any) => tag.name).join(' '),
          isPublic: problem.isPublic,
          isContestOnly: problem.isContestOnly,
          reviewStatus: problem.reviewStatus,
        });
        return loadTestcases(problem.id);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : '加载题目失败'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loadTestcases]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        tags: form.tags.split(/[\s,，]+/).filter(Boolean),
        memoryLimit: Number(form.memoryLimit),
        timeLimit: Number(form.timeLimit),
        difficulty: Number(form.difficulty),
      };
      if (id) {
        await api.put(`/api/problems/${id}`, payload);
        toast.success('题目已保存');
        void loadTestcases(id);
      } else {
        const result = await api.post<{ problem: { id: number } }>('/api/problems', payload);
        toast.success('题目已创建');
        navigate(`/admin/problems/${result.problem.id}/edit`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const uploadZip = async (file: File, replace: boolean) => {
    if (!id) {
      toast.error('请先保存题目');
      return;
    }
    try {
      const result = await api.upload<{ imported: number }>(
        `/api/problems/${id}/testcases/zip?replace=${replace ? 'true' : 'false'}`,
        file,
      );
      toast.success(`成功导入 ${result.imported} 个测试点`);
      void loadTestcases(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败');
    }
  };

  const saveTestcase = async () => {
    if (!id || !caseModal) return;
    try {
      if (caseModal.id) {
        await api.put(`/api/problems/${id}/testcases/${caseModal.id}`, {
          input: caseModal.input,
          output: caseModal.output,
          subtask: Number(caseModal.subtask) || 0,
          score: Number(caseModal.score) || 0,
          isSample: Boolean(caseModal.isSample),
        });
      } else {
        await api.post(`/api/problems/${id}/testcases`, {
          idx: Number(caseModal.idx) || 0,
          input: caseModal.input ?? '',
          output: caseModal.output ?? '',
          subtask: Number(caseModal.subtask) || 0,
          score: Number(caseModal.score) || 10,
          isSample: Boolean(caseModal.isSample),
        });
      }
      toast.success('测试点已保存');
      setCaseModal(null);
      void loadTestcases(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const editTestcase = async (testcase: any) => {
    try {
      const result = await api.get<any>(`/api/problems/${id}/testcases/${testcase.id}`);
      setCaseModal({ ...result.testcase, input: result.testcase.input, output: result.testcase.output });
    } catch {
      setCaseModal({ ...testcase, input: '', output: '' });
    }
  };

  const deleteTestcase = async (testcase: any) => {
    if (!window.confirm(`确定删除测试点 #${testcase.idx} 吗？`)) return;
    await api.del(`/api/problems/${id}/testcases/${testcase.id}`);
    toast.success('已删除');
    void loadTestcases(id!);
  };

  const rejudge = async () => {
    if (!id) return;
    if (!window.confirm('确定重测本题的全部提交吗？')) return;
    try {
      const result = await api.post<{ affected: number }>('/api/submissions/rejudge', { problemId: Number(id) });
      toast.success(`已加入重测队列：${result.affected} 条提交`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重测失败');
    }
  };

  if (loading) return <Loading />;

  const languages = meta?.languages ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">
          {id ? `编辑题目 ${form.pid}` : '新建题目'}
          {form.reviewStatus && form.reviewStatus !== 'approved' && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
              {form.reviewStatus === 'pending' ? '待审核' : '已驳回'}
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2">
          {id && (
            <>
              <a href={`/api/problems/${id}/testdata.zip`} className="btn-ghost !py-1.5 text-xs">
                下载数据
              </a>
              <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={rejudge}>
                <RefreshCw className="h-3.5 w-3.5" /> 重测本题
              </button>
            </>
          )}
          <button type="button" className="btn-primary !py-1.5 text-xs" disabled={saving} onClick={save}>
            <Save className="h-3.5 w-3.5" /> {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'basic', label: '基本信息' },
            { key: 'statement', label: '题面' },
            { key: 'samples', label: '样例', badge: form.samples.length || undefined },
            { key: 'subtasks', label: '子任务', badge: form.subtasks.length || undefined },
            { key: 'testcases', label: '测试数据', badge: testcases.length || undefined },
            { key: 'judge', label: '评测配置' },
          ]}
        />

        <div className="space-y-4 p-4">
          {tab === 'basic' && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="题目编号" hint="留空自动生成">
                <input className="input" value={form.pid} onChange={(e) => setForm({ ...form, pid: e.target.value })} />
              </Field>
              <Field label="题目标题" required>
                <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </Field>
              <Field label="难度">
                <select
                  className="input"
                  value={form.difficulty}
                  onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })}
                >
                  {difficultyList().map((item) => (
                    <option key={item.level} value={item.level}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="题目来源">
                <input
                  className="input"
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}
                  placeholder="例如：OGOJ 原创"
                />
              </Field>
              <Field label="时间限制 (ms)">
                <input
                  className="input"
                  type="number"
                  value={form.timeLimit}
                  onChange={(e) => setForm({ ...form, timeLimit: Number(e.target.value) })}
                />
              </Field>
              <Field label="内存限制 (MB)">
                <input
                  className="input"
                  type="number"
                  value={form.memoryLimit}
                  onChange={(e) => setForm({ ...form, memoryLimit: Number(e.target.value) })}
                />
              </Field>
              <Field label="算法标签" hint="用空格分隔，标签不存在时会自动创建">
                <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
              </Field>
              <Field label="允许的语言" hint="不选择表示全部允许">
                <div className="flex flex-wrap gap-2">
                  {languages.map((language) => (
                    <label key={language.id} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={(form.allowLanguages ?? []).includes(language.id)}
                        onChange={(event) => {
                          const list: string[] = form.allowLanguages ?? [];
                          setForm({
                            ...form,
                            allowLanguages: event.target.checked
                              ? [...list, language.id]
                              : list.filter((item) => item !== language.id),
                          });
                        }}
                      />
                      {language.name}
                    </label>
                  ))}
                </div>
              </Field>
              <div className="space-y-2 md:col-span-2">
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.isPublic}
                    onChange={(e) => setForm({ ...form, isPublic: e.target.checked })}
                  />
                  公开题目（在题库中显示）
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.isContestOnly}
                    onChange={(e) => setForm({ ...form, isContestOnly: e.target.checked })}
                  />
                  仅比赛可用（不在题库公开展示）
                </label>
                <Field label="审核状态">
                  <select
                    className="input md:w-48"
                    value={form.reviewStatus}
                    onChange={(e) => setForm({ ...form, reviewStatus: e.target.value, isPublic: e.target.value === 'approved' })}
                  >
                    <option value="approved">已通过（公开）</option>
                    <option value="pending">待审核</option>
                    <option value="rejected">已驳回</option>
                  </select>
                </Field>
              </div>
            </div>
          )}

          {tab === 'statement' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">支持 Markdown，行内公式 $...$，行间公式 $$...$$</span>
                <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => setPreview((v) => !v)}>
                  {preview ? '继续编辑' : '预览题面'}
                </button>
              </div>
              {(
                [
                  ['background', '题目背景'],
                  ['statement', '题目描述'],
                  ['inputFormat', '输入格式'],
                  ['outputFormat', '输出格式'],
                  ['hint', '提示 / 说明'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  {preview ? (
                    <div className="min-h-[80px] rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                      <Markdown>{form[key]}</Markdown>
                    </div>
                  ) : (
                    <textarea
                      className="input min-h-[140px] font-mono text-xs"
                      value={form[key] ?? ''}
                      onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                    />
                  )}
                </Field>
              ))}
            </div>
          )}

          {tab === 'samples' && (
            <div className="space-y-3">
              {form.samples.map((sample: Sample, index: number) => (
                <div key={index} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium">样例 #{index + 1}</span>
                    <button
                      type="button"
                      className="text-rose-500"
                      onClick={() =>
                        setForm({ ...form, samples: form.samples.filter((_: Sample, i: number) => i !== index) })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="输入">
                      <textarea
                        className="input min-h-[100px] font-mono text-xs"
                        value={sample.input}
                        onChange={(event) => {
                          const samples = [...form.samples];
                          samples[index] = { ...sample, input: event.target.value };
                          setForm({ ...form, samples });
                        }}
                      />
                    </Field>
                    <Field label="输出">
                      <textarea
                        className="input min-h-[100px] font-mono text-xs"
                        value={sample.output}
                        onChange={(event) => {
                          const samples = [...form.samples];
                          samples[index] = { ...sample, output: event.target.value };
                          setForm({ ...form, samples });
                        }}
                      />
                    </Field>
                  </div>
                  <Field label="样例解释">
                    <input
                      className="input"
                      value={sample.explanation ?? ''}
                      onChange={(event) => {
                        const samples = [...form.samples];
                        samples[index] = { ...sample, explanation: event.target.value };
                        setForm({ ...form, samples });
                      }}
                    />
                  </Field>
                </div>
              ))}
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setForm({ ...form, samples: [...form.samples, { input: '', output: '', explanation: '' }] })}
              >
                <Plus className="h-4 w-4" /> 添加样例
              </button>
              <p className="text-xs text-slate-400">
                提示：样例不会自动成为测试数据，请在「测试数据」中上传完整数据，并把对应测试点标记为样例。
              </p>
            </div>
          )}

          {tab === 'subtasks' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                子任务用于捆绑测试：默认「全部通过才得分」，也可以选择「按测试点累加」。deps 表示依赖的子任务编号。
              </p>
              {form.subtasks.map((subtask: Subtask, index: number) => (
                <div key={index} className="grid gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-5 dark:border-slate-700">
                  <Field label="编号">
                    <input
                      className="input"
                      type="number"
                      value={subtask.id}
                      onChange={(event) => {
                        const subtasks = [...form.subtasks];
                        subtasks[index] = { ...subtask, id: Number(event.target.value) };
                        setForm({ ...form, subtasks });
                      }}
                    />
                  </Field>
                  <Field label="分值">
                    <input
                      className="input"
                      type="number"
                      value={subtask.score}
                      onChange={(event) => {
                        const subtasks = [...form.subtasks];
                        subtasks[index] = { ...subtask, score: Number(event.target.value) };
                        setForm({ ...form, subtasks });
                      }}
                    />
                  </Field>
                  <Field label="测试点编号" hint="逗号分隔，留空表示按测试点所属子任务">
                    <input
                      className="input"
                      value={(subtask.cases ?? []).join(',')}
                      onChange={(event) => {
                        const subtasks = [...form.subtasks];
                        subtasks[index] = {
                          ...subtask,
                          cases: event.target.value
                            .split(/[\s,]+/)
                            .map(Number)
                            .filter(Boolean),
                        };
                        setForm({ ...form, subtasks });
                      }}
                    />
                  </Field>
                  <Field label="计分方式">
                    <select
                      className="input"
                      value={subtask.method ?? 'min'}
                      onChange={(event) => {
                        const subtasks = [...form.subtasks];
                        subtasks[index] = { ...subtask, method: event.target.value as 'min' | 'sum' };
                        setForm({ ...form, subtasks });
                      }}
                    >
                      <option value="min">全部通过才得分</option>
                      <option value="sum">按测试点累加</option>
                    </select>
                  </Field>
                  <Field label="依赖">
                    <div className="flex gap-2">
                      <input
                        className="input"
                        value={(subtask.deps ?? []).join(',')}
                        onChange={(event) => {
                          const subtasks = [...form.subtasks];
                          subtasks[index] = {
                            ...subtask,
                            deps: event.target.value
                              .split(/[\s,]+/)
                              .map(Number)
                              .filter(Boolean),
                          };
                          setForm({ ...form, subtasks });
                        }}
                      />
                      <button
                        type="button"
                        className="text-rose-500"
                        onClick={() =>
                          setForm({ ...form, subtasks: form.subtasks.filter((_: Subtask, i: number) => i !== index) })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </Field>
                </div>
              ))}
              <button
                type="button"
                className="btn-ghost"
                onClick={() =>
                  setForm({
                    ...form,
                    subtasks: [
                      ...form.subtasks,
                      { id: (form.subtasks.at(-1)?.id ?? 0) + 1, score: 10, cases: [], method: 'min', deps: [] },
                    ],
                  })
                }
              >
                <Plus className="h-4 w-4" /> 添加子任务
              </button>
            </div>
          )}

          {tab === 'testcases' && (
            <div className="space-y-3">
              {!id ? (
                <EmptyState title="请先保存题目" description="保存后才能上传测试数据" />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn-primary !py-1.5 text-xs"
                      onClick={() =>
                        setCaseModal({
                          idx: (testcases.at(-1)?.idx ?? 0) + 1,
                          subtask: 0,
                          score: 10,
                          isSample: false,
                          input: '',
                          output: '',
                        })
                      }
                    >
                      <Plus className="h-3.5 w-3.5" /> 手动添加测试点
                    </button>
                    <label className="btn-ghost cursor-pointer !py-1.5 text-xs">
                      <Upload className="h-3.5 w-3.5" /> 上传 ZIP（追加）
                      <input
                        type="file"
                        accept=".zip"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadZip(file, false);
                          event.target.value = '';
                        }}
                      />
                    </label>
                    <label className="btn-ghost cursor-pointer !py-1.5 text-xs">
                      <Upload className="h-3.5 w-3.5" /> 上传 ZIP（覆盖全部）
                      <input
                        type="file"
                        accept=".zip"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadZip(file, true);
                          event.target.value = '';
                        }}
                      />
                    </label>
                    <span className="text-xs text-slate-400">
                      ZIP 中需要按 <code>1.in / 1.out</code> 或 <code>a.in / a.ans</code> 成对命名
                    </span>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th className="w-16">#</th>
                          <th className="w-24">子任务</th>
                          <th className="w-20">分值</th>
                          <th className="w-20">样例</th>
                          <th className="w-28">输入大小</th>
                          <th className="w-28">输出大小</th>
                          <th className="w-32">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testcases.map((testcase) => (
                          <tr key={testcase.id}>
                            <td>{testcase.idx}</td>
                            <td>{testcase.subtask || '-'}</td>
                            <td>{testcase.score}</td>
                            <td>{testcase.isSample ? '是' : '否'}</td>
                            <td className="text-xs text-slate-500">{formatBytes(testcase.inputSize)}</td>
                            <td className="text-xs text-slate-500">{formatBytes(testcase.outputSize)}</td>
                            <td>
                              <div className="flex gap-2 text-xs">
                                <button type="button" className="text-primary hover:underline" onClick={() => editTestcase(testcase)}>
                                  编辑
                                </button>
                                <button type="button" className="text-rose-500 hover:underline" onClick={() => deleteTestcase(testcase)}>
                                  删除
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {!testcases.length && (
                          <tr>
                            <td colSpan={7} className="py-6 text-center text-sm text-slate-400">
                              还没有测试数据，题目将无法评测
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'judge' && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="评测方式">
                  <select
                    className="input"
                    value={form.judgeMode}
                    onChange={(event) => setForm({ ...form, judgeMode: event.target.value })}
                  >
                    <option value="standard">标准比对</option>
                    <option value="spj">Special Judge（自定义检查器）</option>
                    <option value="interactive">交互题</option>
                  </select>
                </Field>
                <Field label="答案比对方式" hint="留空表示使用全站默认设置">
                  <select
                    className="input"
                    value={form.compareMode}
                    onChange={(event) => setForm({ ...form, compareMode: event.target.value })}
                  >
                    <option value="">使用全站默认</option>
                    <option value="trim">忽略行末空格</option>
                    <option value="strict">逐字节比较</option>
                    <option value="token">忽略所有空白</option>
                    <option value="float">浮点数误差比较（1e-6）</option>
                  </select>
                </Field>
                {form.judgeMode !== 'standard' && (
                  <Field label="检查器语言">
                    <select
                      className="input"
                      value={form.spjLanguage}
                      onChange={(event) => setForm({ ...form, spjLanguage: event.target.value })}
                    >
                      {['cpp', 'cpp17', 'c', 'python3', 'node'].map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>

              {form.judgeMode === 'spj' && (
                <div>
                  <div className="mb-1 text-sm font-medium">Special Judge 代码</div>
                  <p className="mb-2 text-xs text-slate-500">
                    程序会收到三个参数：<code>argv[1]</code> 输入文件、<code>argv[2]</code> 选手输出、<code>argv[3]</code> 标准答案。
                    返回 0 表示通过，非 0 表示不通过；也可在标准输出中打印 <code>score: 50</code> 给出部分分。
                  </p>
                  <CodeEditor
                    value={form.spjCode}
                    onChange={(value) => setForm({ ...form, spjCode: value })}
                    language="cpp"
                    height="320px"
                  />
                </div>
              )}

              {form.judgeMode === 'interactive' && (
                <div>
                  <div className="mb-1 text-sm font-medium">交互库代码</div>
                  <p className="mb-2 text-xs text-slate-500">
                    交互库参数：<code>argv[1]</code> 测试输入文件、<code>argv[2]</code> 写给选手的管道、<code>argv[3]</code> 读取选手输出的管道。
                  </p>
                  <CodeEditor
                    value={form.interCode}
                    onChange={(value) => setForm({ ...form, interCode: value })}
                    language="cpp"
                    height="320px"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(caseModal)}
        title={caseModal?.id ? `编辑测试点 #${caseModal.idx}` : '新增测试点'}
        onClose={() => setCaseModal(null)}
        width="max-w-4xl"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setCaseModal(null)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={saveTestcase}>
              保存测试点
            </button>
          </>
        }
      >
        {caseModal && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="编号">
                <input
                  className="input"
                  type="number"
                  value={caseModal.idx ?? ''}
                  onChange={(event) => setCaseModal({ ...caseModal, idx: Number(event.target.value) })}
                  disabled={Boolean(caseModal.id)}
                />
              </Field>
              <Field label="所属子任务">
                <input
                  className="input"
                  type="number"
                  value={caseModal.subtask ?? 0}
                  onChange={(event) => setCaseModal({ ...caseModal, subtask: Number(event.target.value) })}
                />
              </Field>
              <Field label="分值">
                <input
                  className="input"
                  type="number"
                  value={caseModal.score ?? 10}
                  onChange={(event) => setCaseModal({ ...caseModal, score: Number(event.target.value) })}
                />
              </Field>
              <Field label="作为样例显示">
                <label className="flex items-center gap-2 pt-2 text-sm text-slate-500">
                  <input
                    type="checkbox"
                    checked={Boolean(caseModal.isSample)}
                    onChange={(event) => setCaseModal({ ...caseModal, isSample: event.target.checked })}
                  />
                  是
                </label>
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="输入数据">
                <textarea
                  className={classNames('input min-h-[240px] font-mono text-xs')}
                  value={caseModal.input ?? ''}
                  onChange={(event) => setCaseModal({ ...caseModal, input: event.target.value })}
                />
              </Field>
              <Field label="输出数据">
                <textarea
                  className={classNames('input min-h-[240px] font-mono text-xs')}
                  value={caseModal.output ?? ''}
                  onChange={(event) => setCaseModal({ ...caseModal, output: event.target.value })}
                />
              </Field>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
