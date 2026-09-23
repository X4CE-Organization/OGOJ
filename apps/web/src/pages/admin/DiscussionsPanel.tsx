import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Pin, Trash2, Undo2 } from 'lucide-react';
import { api, query } from '../../lib/api';
import { classNames, fromNow } from '../../lib/format';
import { EmptyState, Loading, Pagination } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function DiscussionsPanel() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(
        `/api/admin/discussions${query({ page, size: 50, q: search, deleted: showDeleted ? 'true' : '' })}`,
      );
      setData(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, showDeleted]);

  useEffect(() => {
    void load();
  }, [load]);

  const moderate = async (discussion: any, patch: Record<string, unknown>, message: string) => {
    try {
      await api.post(`/api/admin/discussions/${discussion.id}/moderate`, patch);
      toast.success(message);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">帖子管理</h1>
        <span className="text-sm text-slate-500">共 {data?.total ?? 0} 个帖子</span>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <input
          className="input !w-64"
          placeholder="搜索标题 / 内容"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <label className="flex items-center gap-1.5 text-sm text-slate-500">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(event) => {
              setShowDeleted(event.target.checked);
              setPage(1);
            }}
          />
          只看已删除
        </label>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="没有帖子" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>标题</th>
                  <th className="w-28">作者</th>
                  <th className="w-24">回复</th>
                  <th className="w-32">发布时间</th>
                  <th className="w-64">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((discussion: any) => (
                  <tr key={discussion.id} className={classNames(discussion.is_deleted && 'opacity-60')}>
                    <td>
                      <div className="flex items-center gap-2">
                        {discussion.is_pinned && <Pin className="h-3 w-3 text-rose-500" />}
                        {discussion.is_locked && <Lock className="h-3 w-3 text-slate-400" />}
                        <Link to={`/discussion/${discussion.id}`} className="hover:text-primary">
                          {discussion.title}
                        </Link>
                        {discussion.is_deleted && (
                          <span className="rounded bg-rose-100 px-1 text-[10px] text-rose-600 dark:bg-rose-500/20">
                            已删除
                          </span>
                        )}
                      </div>
                      <div className="line-clamp-1 text-[11px] text-slate-400">{discussion.content}</div>
                    </td>
                    <td className="text-xs">{discussion.username}</td>
                    <td className="text-xs">{discussion.reply_count}</td>
                    <td className="text-xs text-slate-400">{fromNow(discussion.created_at)}</td>
                    <td>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => moderate(discussion, { isPinned: !discussion.is_pinned }, '已更新置顶状态')}
                        >
                          {discussion.is_pinned ? '取消置顶' : '置顶'}
                        </button>
                        <button
                          type="button"
                          className="text-slate-500 hover:underline"
                          onClick={() => moderate(discussion, { isLocked: !discussion.is_locked }, '已更新锁定状态')}
                        >
                          {discussion.is_locked ? '解锁' : '锁定'}
                        </button>
                        {discussion.is_deleted ? (
                          <button
                            type="button"
                            className="text-emerald-600 hover:underline"
                            onClick={() => moderate(discussion, { isDeleted: false }, '已恢复帖子')}
                          >
                            <Undo2 className="mr-0.5 inline h-3.5 w-3.5" />
                            恢复
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="text-rose-500 hover:underline"
                            onClick={() => {
                              if (window.confirm('确定删除该帖子吗？')) {
                                void moderate(discussion, { isDeleted: true }, '已删除帖子');
                              }
                            }}
                          >
                            <Trash2 className="mr-0.5 inline h-3.5 w-3.5" />
                            删除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} size={50} total={data?.total ?? 0} onChange={setPage} />
      </div>
    </div>
  );
}
