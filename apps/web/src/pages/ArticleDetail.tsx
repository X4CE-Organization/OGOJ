import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatTime, fromNow } from '../lib/format';
import { Avatar, EmptyState, Loading } from '../components/ui';
import BackButton from '../components/BackButton';
import Markdown from '../components/Markdown';
import { useToast } from '../components/Toast';

export default function ArticleDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [article, setArticle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [comments, setComments] = useState<any[]>([]);

  const loadComments = useCallback(() => {
    api
      .get<{ items: any[] }>(`/api/comments?targetType=article&targetId=${id}`)
      .then((data) => setComments(data.items))
      .catch(() => undefined);
  }, [id]);

  useEffect(() => {
    api
      .get<any>(`/api/articles/${id}`)
      .then((data) => setArticle(data.article))
      .catch(() => setArticle(null))
      .finally(() => setLoading(false));
    loadComments();
  }, [id, loadComments]);

  const postComment = async () => {
    if (!user) {
      toast.error('请先登录');
      return;
    }
    try {
      await api.post('/api/comments', { targetType: 'article', targetId: Number(id), content: comment });
      setComment('');
      loadComments();
      toast.success('评论成功');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '评论失败');
    }
  };

  const remove = async () => {
    if (!window.confirm('确定要删除这篇文章吗？')) return;
    try {
      await api.del(`/api/articles/${id}`);
      toast.success('已删除');
      navigate('/articles');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  if (loading) return <Loading />;
  if (!article) return <EmptyState title="文章不存在或未公开" />;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackButton label="返回文章广场" listKey="articles" fallback="/articles" />
      <article className="card p-6">
        <h1 className="text-2xl font-bold">{article.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <Avatar user={article.author} size={22} />
            {article.display_name || article.username}
          </span>
          <span>{formatTime(article.created_at)}</span>
          <span>{fromNow(article.updated_at)}更新</span>
          <span className="flex items-center gap-1">
            <Eye className="h-3 w-3" />
            {article.views}
          </span>
          <span className="rounded bg-primary/10 px-1.5 text-primary">{article.category}</span>
          {!article.is_public && (
            <span className="rounded bg-amber-100 px-1.5 text-amber-700 dark:bg-amber-500/20">未公开</span>
          )}
          {article.canEdit && (
            <span className="ml-auto flex items-center gap-3">
              <Link to={`/article/${article.id}/edit`} className="inline-flex items-center gap-1 text-primary">
                <Pencil className="h-3 w-3" /> 编辑
              </Link>
              <button type="button" className="inline-flex items-center gap-1 text-rose-500" onClick={remove}>
                <Trash2 className="h-3 w-3" /> 删除
              </button>
            </span>
          )}
        </div>
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <Markdown>{article.content}</Markdown>
        </div>
      </article>

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold">评论（{comments.length}）</h2>
        <ul className="space-y-3">
          {comments.map((item) => (
            <li key={item.id} className="flex gap-3">
              <Avatar user={item.author} size={30} />
              <div>
                <div className="text-xs text-slate-400">
                  {item.display_name || item.username} · {fromNow(item.created_at)}
                </div>
                <p className="mt-1 text-sm">{item.content}</p>
              </div>
            </li>
          ))}
          {comments.length === 0 && <li className="text-sm text-slate-400">还没有评论</li>}
        </ul>
        {user ? (
          <div className="mt-4">
            <textarea
              className="input min-h-[90px]"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="说点什么…"
            />
            <div className="mt-2 flex justify-end">
              <button type="button" className="btn-primary" onClick={postComment}>
                发表评论
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">
            <Link to="/login" className="link">
              登录
            </Link>{' '}
            后发表评论。
          </p>
        )}
      </div>
    </div>
  );
}
