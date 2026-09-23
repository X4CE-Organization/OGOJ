import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { classNames, fromNow } from '../../lib/format';
import { EmptyState, Field, Loading, Section, StatusText } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function JudgePanel() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [problemId, setProblemId] = useState('');
  const [contestId, setContestId] = useState('');
  const [submissionIds, setSubmissionIds] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api.get<any>('/api/admin/judge/status');
      setData(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const requeue = async () => {
    const payload: Record<string, unknown> = {};
    if (problemId) payload.problemId = Number(problemId);
    if (contestId) payload.contestId = Number(contestId);
    if (submissionIds) {
      payload.submissionIds = submissionIds
        .split(/[\s,]+/)
        .map(Number)
        .filter(Boolean);
    }
    if (!Object.keys(payload).length) {
      toast.error('请填写至少一个重测条件');
      return;
    }
    if (!window.confirm('确定将匹配的提交加入重测队列吗？')) return;
    try {
      const result = await api.post<{ affected: number }>('/api/admin/judge/requeue', payload);
      toast.success(`已加入重测队列：${result.affected} 条提交`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重测失败');
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">评测机状态</h1>
        <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> 刷新
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: '等待评测', value: data?.waiting ?? 0 },
          { label: '正在评测', value: data?.judging ?? 0 },
          { label: '并发数', value: data?.concurrency ?? 0 },
          { label: '工作线程', value: data?.worker?.running ? '运行中' : '未启动' },
        ].map((item) => (
          <div key={item.label} className="card p-4">
            <div className="text-xs text-slate-400">{item.label}</div>
            <div className="mt-1 text-xl font-semibold text-primary">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Section title="批量重测">
          <div className="space-y-3 p-4">
            <Field label="题目 ID">
              <input className="input" value={problemId} onChange={(e) => setProblemId(e.target.value)} placeholder="例如 1" />
            </Field>
            <Field label="比赛 ID">
              <input className="input" value={contestId} onChange={(e) => setContestId(e.target.value)} />
            </Field>
            <Field label="提交编号" hint="多个编号用空格分隔">
              <input className="input" value={submissionIds} onChange={(e) => setSubmissionIds(e.target.value)} />
            </Field>
            <button type="button" className="btn-primary w-full" onClick={requeue}>
              加入重测队列
            </button>
            <p className="text-xs text-slate-400">
              注意：重测会重置提交的分数与测试点详情，并重新计算通过状态与积分。
            </p>
          </div>
        </Section>

        <Section title="最近的提交">
          {!data?.recent?.length ? (
            <EmptyState title="暂无提交" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="w-20">编号</th>
                    <th className="w-24">题目</th>
                    <th className="w-28">用户</th>
                    <th className="w-36">结果</th>
                    <th className="w-20">用时</th>
                    <th className="w-24">内存</th>
                    <th className="w-32">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((submission: any) => (
                    <tr key={submission.id}>
                      <td>
                        <Link to={`/record/${submission.id}`} className="link font-mono text-xs">
                          #{submission.id}
                        </Link>
                      </td>
                      <td className="font-mono text-xs">{submission.pid}</td>
                      <td className="text-xs">{submission.username}</td>
                      <td>
                        <StatusText status={submission.status} />
                      </td>
                      <td className="text-xs text-slate-500">{submission.time_ms ?? '-'} ms</td>
                      <td className="text-xs text-slate-500">{submission.memory_kb ?? '-'} KB</td>
                      <td className="text-xs text-slate-400">{fromNow(submission.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <Section title="支持的评测语言">
        <div className="flex flex-wrap gap-2 p-4">
          {(data?.available ?? []).map((language: string) => (
            <span key={language} className={classNames('rounded bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800')}>
              {language}
            </span>
          ))}
          <p className="w-full text-xs text-slate-400">
            评测机自动检测服务器上已安装的编译器。若要启用更多语言，请在服务器上安装对应的编译器（g++ / python3 / javac / node / go / rustc）后重启服务。
          </p>
        </div>
      </Section>
    </div>
  );
}
