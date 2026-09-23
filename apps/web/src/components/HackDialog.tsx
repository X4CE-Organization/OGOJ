import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crosshair, Zap } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, formatMs, LANGUAGE_NAMES } from '../lib/format';
import { Field, Loading, Modal, StatusText, UserLink } from './ui';
import CodeEditor from './CodeEditor';
import { useToast } from './Toast';

export default function HackDialog({
  submissionId,
  open,
  onClose,
  onDone,
}: {
  submissionId: number | null;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [submission, setSubmission] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (!open || !submissionId) return;
    setLoading(true);
    setResult(null);
    api
      .get<any>(`/api/submissions/${submissionId}`)
      .then((data) => setSubmission(data.submission))
      .catch(() => setSubmission(null))
      .finally(() => setLoading(false));
  }, [open, submissionId]);

  const submit = async () => {
    if (!input.trim()) {
      toast.error('请填写 Hack 数据');
      return;
    }
    setSubmitting(true);
    try {
      const data = await api.post<any>('/api/hacks', { submissionId, input });
      setResult(data);
      if (data.verdict === 'success') toast.success(data.message ?? 'Hack 成功！');
      else if (data.verdict === 'fail') toast.push(data.message ?? 'Hack 失败', 'info');
      else toast.error(data.message ?? 'Hack 数据无效');
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Hack 失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Hack 这次提交"
      onClose={onClose}
      width="max-w-3xl"
      footer={
        result ? (
          <button type="button" className="btn-ghost" onClick={onClose}>
            关闭
          </button>
        ) : (
          <>
            <button type="button" className="btn-ghost" onClick={onClose}>
              取消
            </button>
            <button type="button" className="btn-primary" disabled={submitting} onClick={submit}>
              <Zap className="h-4 w-4" />
              {submitting ? '正在评测…' : '提交 Hack'}
            </button>
          </>
        )
      }
    >
      {loading ? (
        <Loading />
      ) : !submission ? (
        <p className="text-sm text-slate-500">无法加载目标提交。</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">
                <Link to={`/problem/${submission.problemPid}`} className="link">
                  {submission.problemPid} {submission.problemTitle}
                </Link>
              </span>
              <span className="text-xs text-slate-400">
                #{submission.id} · {LANGUAGE_NAMES[submission.language] ?? submission.language} ·{' '}
                {formatMs(submission.timeMs)}
              </span>
              <StatusText status={submission.status} />
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                提交者 <UserLink user={submission.user} size={18} />
              </span>
            </div>
          </div>

          {!result && (
            <>
              <p className="text-xs text-slate-500">
                构造一组能让这份代码出错的数据。系统会用题目配置的<b>参考程序</b>生成标准答案，
                然后把你的数据加入测试集并重新评测这份提交：
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-500">
                <li>目标提交变成非 AC（WA / TLE / RE …）→ Hack 成功，你获得积分；</li>
                <li>目标程序依然正确 → Hack 失败，数据不会进入题库。</li>
              </ul>
              <Field label="Hack 数据（程序的标准输入）" required>
                <CodeEditor value={input} onChange={setInput} language="cpp" height="220px" />
              </Field>
              {!user && <p className="text-sm text-rose-500">请先登录后再 Hack。</p>}
            </>
          )}

          {result && (
            <div
              className={classNames(
                'rounded-lg border p-3 text-sm',
                result.verdict === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
                  : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200',
              )}
            >
              <div className="flex items-center gap-2 font-semibold">
                <Crosshair className="h-4 w-4" />
                {result.verdict === 'success' ? 'Hack 成功！' : result.verdict === 'fail' ? 'Hack 失败' : '数据无效'}
              </div>
              <p className="mt-1">{result.message}</p>
              {result.statusBefore && (
                <p className="mt-1 text-xs">
                  目标提交：{result.statusBefore} → {result.statusAfter}，得分 {result.scoreAfter ?? 0}；
                  你的积分变化 {result.pointsDelta > 0 ? `+${result.pointsDelta}` : result.pointsDelta}
                </p>
              )}
              {Array.isArray(result.detail) && result.detail.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {result.detail.map((item: any) => (
                    <li key={item.idx}>
                      #{item.idx} {item.status}
                      {item.message ? ` · ${String(item.message).slice(0, 80)}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
