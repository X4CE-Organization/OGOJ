import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Pin, Trash2, Undo2 } from 'lucide-react';
import { api, query } from '../../lib/api';
import { classNames, fromNow } from '../../lib/format';
import { EmptyState, Loading, Pagination } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function MomentsPanel() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [deleted, setDeleted] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(
        `/api/admin/moments${query({ page, size: 50, q: search, deleted })}`,
      );
      setData(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, deleted]);

  useEffect(() => {
    void load();
  }, [load]);

  const pin = async (item: any) => {
    try {
      await api.post(`/api/admin/moments/${item.id}/pin`);
      toast.success(item.isPinned ? '已取消置顶' : '已置顶');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const remove = async (item: any) => {
    if (!window.confirm('确定删除这条动态吗？')) return;
    try {
      await api.del(`/api/admin/moments/${item.id}`);
      toast.success('已删除动态');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const restore = async (item: any) => {
    try {
      await api.post(`/api/admin/moments/${item.id}/restore`);
      toast.success('已恢复动态');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">动态管理</h1>
        <span className="text-sm text-slate-500">共 {data?.total ?? 0} 条</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        {[
          ['正常动态', data?.stats?.total ?? 0],
          ['今日发布', data?.stats?.today ?? 0],
          ['置顶', data?.stats?.pinned ?? 0],
          ['已删除', data?.stats?.deleted ?? 0],
        ].map(([label, value]) => (
          <div key={String(label)} className="card p-3">
            <div className="text-xs text-slate-400">{label}</div>
            <div className="mt-1 text-xl font-bold text-primary">{value}</div>
          </div>
        ))}
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <input
          className="input !w-64"
          placeholder="搜索动态内容"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <select
          className="input !w-40"
          value={deleted}
          onChange={(event) => {
            setDeleted(event.target.value);
            setPage(1);
          }}
        >
          <option value="">全部状态</option>
          <option value="false">只看正常</option>
          <option value="true">只看已删除</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="没有动态" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>内容</th>
                  <th className="w-28">作者</th>
                  <th className="w-24">互动</th>
                  <th className="w-32">发布时间</th>
                  <th className="w-56">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item: any) => (
                  <tr key={item.id} className={classNames(item.isDeleted && 'opacity-60')}>
                    <td>
                      <div className="flex items-center gap-2">
                        {item.isPinned && <Pin className="h-3 w-3 text-amber-500" />}
                        <Link to={`/moment/${item.id}`} className="line-clamp-2 hover:text-primary">
                          {item.content || '[图片]'}
                        </Link>
                        {item.isDeleted && (
                          <span className="rounded bg-rose-100 px-1 text-[10px] text-rose-600 dark:bg-rose-500/20">
                            已删除
                          </span>
                        )}
                      </div>
                      {item.images?.length > 0 && (
                        <span className="text-[11px] text-slate-400">{item.images.length} 张图片</span>
                      )}
                    </td>
                    <td className="text-xs">{item.username}</td>
                    <td className="text-xs text-slate-500">
                      {item.likeCount} 赞 · {item.commentCount} 评
                    </td>
                    <td className="text-xs text-slate-400">{fromNow(item.createdAt)}</td>
                    <td>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Link to={`/moment/${item.id}`} className="text-slate-500 hover:underline">
                          <ExternalLink className="mr-0.5 inline h-3.5 w-3.5" />
                          查看
                        </Link>
                        {!item.isDeleted && (
                          <button type="button" className="text-primary hover:underline" onClick={() => pin(item)}>
                            {item.isPinned ? '取消置顶' : '置顶'}
                          </button>
                        )}
                        {item.isDeleted ? (
                          <button
                            type="button"
                            className="text-emerald-600 hover:underline"
                            onClick={() => restore(item)}
                          >
                            <Undo2 className="mr-0.5 inline h-3.5 w-3.5" />
                            恢复
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="text-rose-500 hover:underline"
                            onClick={() => remove(item)}
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
