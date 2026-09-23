import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, formatTime } from '../lib/format';
import { Avatar, EmptyState, Loading } from '../components/ui';
import Markdown from '../components/Markdown';
import { useToast } from '../components/Toast';

export default function SolutionDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [solution, setSolution] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.get<any>(`/api/solutions/${id}`);
      setSolution(data.solution);
    } catch {
      setSolution(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const vote = async (value: number) => {
    if (!user) {
      toast.error('请先登录');
      return;
    }
    try {
      await api.post(`/api/solutions/${id}/vote`, { value });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const remove = async () => {
    if (!window.confirm('确定删除这篇题解吗？')) return;
    try {
      await api.del(`/api/solutions/${id}`);
      toast.success('已删除');
      navigate(-1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  if (loading) return <Loading />;
  if (!solution) return <EmptyState title="题解不存在或未公开" />;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <article className="card p-6">
        <h1 className="text-2xl font-bold">{solution.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <Avatar user={{ username: solution.username, display_name: solution.display_name, avatar: solution.avatar }} size={22} />
          <span>{solution.display_name || solution.username}</span>
          <span>{formatTime(solution.created_at)}</span>
          <Link to={`/problem/${solution.pid}`} className="link">
            题目 {solution.pid} {solution.problem_title}
          </Link>
          {solution.canEdit && (
            <button type="button" className="ml-auto inline-flex items-center gap-1 text-rose-500" onClick={remove}>
              <Trash2 className="h-3 w-3" /> 删除
            </button>
          )}
        </div>
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <Markdown>{solution.content}</Markdown>
        </div>
        <div className="mt-6 flex items-center gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button
            type="button"
            onClick={() => vote(1)}
            className={classNames('btn-ghost !py-1.5 text-xs', solution.myVote === 1 && '!text-emerald-600')}
          >
            <ThumbsUp className="h-4 w-4" /> 有帮助 {solution.upvotes}
          </button>
          <button
            type="button"
            onClick={() => vote(-1)}
            className={classNames('btn-ghost !py-1.5 text-xs', solution.myVote === -1 && '!text-rose-500')}
          >
            <ThumbsDown className="h-4 w-4" /> {solution.downvotes}
          </button>
          <span className="ml-auto text-xs text-slate-400">{solution.views} 次浏览</span>
        </div>
      </article>
    </div>
  );
}
