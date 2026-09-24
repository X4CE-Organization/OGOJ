import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Eye, EyeOff, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LANGUAGE_NAMES, formatMemory, formatMs, formatTime, classNames } from '../lib/format';
import { EmptyState, Loading, StatusText, UserLink } from '../components/ui';
import CodeEditor from '../components/CodeEditor';
import { useToast } from '../components/Toast';

export default function RecordDetail() {
  const { id = '' } = useParams();
  const { user, settings } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCode, setShowCode] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.get<any>(`/api/submissions/${id}`);
      setData(result.submission);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while the submission is still queued or being judged.
  useEffect(() => {
    if (!data || (data.status !== 'Waiting' && data.status !== 'Judging')) return undefined;
    const timer = setInterval(load, 1200);
    return () => clearInterval(timer);
  }, [data, load]);

  const rejudge = async () => {
    try {
      await api.post(`/api/submissions/${id}/rejudge`);
      toast.success('已加入重测队列');
      setTimeout(load, 800);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  if (loading) return <Loading />;
  if (error || !data) return <EmptyState title="找不到提交记录" description={error} />;

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const canSeeDetail = settings.show_judge_detail !== false || isAdmin || data.user.id === user?.id;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">提交 #{data.id}</h1>
            <p className="mt-1 text-sm text-slate-500">
              <Link to={`/problem/${data.problemPid}`} className="link">
                {data.problemPid} {data.problemTitle}
              </Link>
              <span className="mx-2 text-slate-300">|</span>
              <span className="mr-1">提交者</span>
              <UserLink user={data.user} size={20} />
              {data.contestId && (
                <>
                  <span className="mx-2 text-slate-300">|</span>
                  <Link to={`/contest/${data.contestId}`} className="link">
                    比赛 #{data.contestId}
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusText status={data.status} score={data.score} />
            {isAdmin && (
              <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={rejudge}>
                <RotateCcw className="h-3.5 w-3.5" /> 重测
              </button>
            )}
            {user && (
              <Link
                to={`/tickets/new?relatedType=submission&relatedId=${data.id}`}
                className="btn-ghost !px-2.5 !py-1 text-xs"
              >
                提交工单
              </Link>
            )}
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
          {[
            ['得分', `${data.score} 分`],
            ['耗时', formatMs(data.timeMs)],
            ['内存', formatMemory(data.memoryKb)],
            ['语言', LANGUAGE_NAMES[data.language] ?? data.language],
            ['提交时间', formatTime(data.createdAt)],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800">
              <dt className="text-slate-400">{label}</dt>
              <dd className="mt-0.5 font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {data.compileOutput && (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold dark:border-slate-800">
            {data.status === 'CE' ? '编译错误信息' : '编译器输出'}
          </div>
          <pre className="scrollbar-thin max-h-80 overflow-auto bg-slate-900 p-4 font-mono text-xs text-slate-100">
{data.compileOutput}
          </pre>
        </div>
      )}

      {canSeeDetail && data.detail?.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold dark:border-slate-800">
            测试点详情
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-20">#</th>
                  <th className="w-28">子任务</th>
                  <th className="w-44">结果</th>
                  <th className="w-24">时间</th>
                  <th className="w-24">内存</th>
                  <th className="w-20">得分</th>
                  <th>信息</th>
                </tr>
              </thead>
              <tbody>
                {data.detail.map((item: any) => (
                  <tr key={item.idx}>
                    <td className="font-mono text-xs">{item.idx}</td>
                    <td className="text-xs text-slate-500">{item.subtask || '-'}</td>
                    <td>
                      <StatusText status={item.status} />
                    </td>
                    <td className="text-xs text-slate-500">{formatMs(item.timeMs)}</td>
                    <td className="text-xs text-slate-500">{formatMemory(item.memoryKb)}</td>
                    <td className="text-xs text-slate-500">{item.score}</td>
                    <td className="max-w-md whitespace-pre-wrap text-xs text-slate-500">{item.message ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.detail?.some((item: any) => item.input || item.output) && (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold dark:border-slate-800">
            测试点数据
          </div>
          <div className="space-y-4 p-4">
            {data.detail
              .filter((item: any) => item.input || item.output)
              .slice(0, 5)
              .map((item: any) => (
                <div key={item.idx} className="grid gap-3 sm:grid-cols-3">
                  {[
                    ['输入', item.input],
                    ['你的输出', item.output],
                    ['参考答案', item.answer],
                  ].map(([label, value]) =>
                    value ? (
                      <div key={label as string}>
                        <div className="mb-1 text-xs font-semibold text-slate-500">
                          #{item.idx} {label}
                        </div>
                        <pre className="scrollbar-thin max-h-48 overflow-auto rounded-lg bg-slate-50 p-2.5 font-mono text-xs dark:bg-slate-800">
{String(value)}
                        </pre>
                      </div>
                    ) : null,
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
          <span className="text-sm font-semibold">源代码</span>
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-1 text-xs"
            onClick={() => setShowCode((value) => !value)}
          >
            {showCode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showCode ? '收起' : '展开'}
          </button>
        </div>
        <div className="p-3">
          {data.codeHidden ? (
            <p className="py-6 text-center text-sm text-slate-500">
              {settings.show_others_code === false
                ? '站点已关闭他人代码查看'
                : '比赛进行中，暂时无法查看他人代码'}
            </p>
          ) : showCode ? (
            <CodeEditor value={data.code ?? ''} language={data.language} readOnly height="420px" />
          ) : (
            <p className={classNames('py-6 text-center text-sm text-slate-500')}>
              代码已隐藏，共 {data.codeLength} 字符，点击「展开」查看
            </p>
          )}
        </div>
      </div>

    </div>
  );
}
