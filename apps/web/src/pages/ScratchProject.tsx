import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Blocks, Download, Eye, Heart, Loader2, Pencil, Play } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames } from '../lib/format';
import { Loading } from '../components/ui';
import { useToast } from '../components/Toast';

const STATE_LABEL: Record<string, string> = {
  draft: '草稿',
  pending: '审核中',
  published: '已发布',
  rejected: '未通过',
  removed: '已下架',
};

export default function ScratchProject() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get<any>(`/api/scratch/projects/${id}`)
      .then(setData)
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : '作品不存在');
        navigate('/scratch');
      })
      .finally(() => setLoading(false));
  }, [id, navigate, toast]);

  async function like() {
    if (!user) {
      toast.push('登录后才能点赞', 'info');
      return;
    }
    try {
      const result = await api.post<{ liked: boolean; likeCount: number }>(`/api/scratch/projects/${id}/like`);
      setData((prev: any) => (prev ? { ...prev, liked: result.liked, likeCount: result.likeCount } : prev));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    }
  }

  if (loading) return <Loading />;
  if (!data) return null;

  const canPlay = data.state === 'published' || data.isMine;
  /** 下载文件名用作品标题，去掉文件系统不接受的字符 */
  const downloadName = `${String(data.title ?? 'scratch-project').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'scratch-project'}.sb3`;
  const downloadUrl = `/api/scratch/projects/${data.id}/file?download=1`;

  return (
    // 和创作页一样占满剩余视口：试玩框铺满它所在的这一块，而不是固定高度的窄条
    <div className="flex h-[calc(100vh-5.5rem)] min-h-[520px] flex-col gap-2">
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <Link to="/scratch" className="btn-ghost text-xs">
          <ArrowLeft className="h-4 w-4" />
          作品中心
        </Link>
        <h1 className="text-sm font-semibold">{data.title}</h1>
        {data.state !== 'published' ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            {STATE_LABEL[data.state] ?? data.state}
          </span>
        ) : null}
        {data.isFeatured ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            精选
          </span>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 md:ml-auto">
          <a className="btn-ghost text-xs" href={downloadUrl} download={downloadName} title="下载作品文件（.sb3）">
            <Download className="h-4 w-4" />
            下载作品文件（.sb3）
          </a>
          <button className={classNames('btn-ghost text-xs', data.liked && 'text-rose-600')} onClick={like}>
            <Heart className={classNames('h-4 w-4', data.liked && 'fill-current')} />
            {data.likeCount}
          </button>
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Eye className="h-4 w-4" />
            {data.views}
          </span>
          {data.canEdit ? (
            <Link to={`/scratch/new?id=${data.id}`} className="btn-ghost text-xs">
              <Pencil className="h-4 w-4" />
              继续编辑
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_300px]">
        <div className="card min-h-0 overflow-hidden p-0">
          {!playing ? (
            <div className="grid h-full min-h-[320px] place-items-center bg-slate-100 dark:bg-slate-800">
              <div className="space-y-3 text-center">
                {data.thumbnail ? (
                  <img src={data.thumbnail} alt={data.title} className="mx-auto max-h-64 rounded-lg border border-slate-200 dark:border-slate-700" />
                ) : (
                  <Blocks className="mx-auto h-12 w-12 text-slate-400" />
                )}
                <div>
                  <button className="btn-primary text-sm" disabled={!canPlay} onClick={() => setPlaying(true)}>
                    <Play className="h-4 w-4" />
                    开始试玩
                  </button>
                </div>
                <div>
                  <a className="btn-ghost text-xs" href={downloadUrl} download={downloadName}>
                    <Download className="h-4 w-4" />
                    下载作品文件（.sb3）
                  </a>
                </div>
                {!canPlay ? <p className="text-xs text-slate-500">作品还未公开，暂时不能试玩</p> : null}
              </div>
            </div>
          ) : (
            <iframe
              ref={frameRef}
              src={`/scratch-editor/index.html?mode=player&project=/api/scratch/projects/${data.id}/file`}
              title={data.title}
              className="h-full min-h-[320px] w-full border-0"
              allow="microphone; camera; fullscreen"
            />
          )}
        </div>

        <aside className="min-h-0 space-y-3 overflow-y-auto">
          <div className="card space-y-2 p-4">
            <h2 className="text-sm font-semibold">玩法说明</h2>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {data.instructions || '作者没有写说明，直接试玩吧。'}
            </p>
          </div>
          <div className="card space-y-2 p-4">
            <h2 className="text-sm font-semibold">作者</h2>
            {data.author ? (
              <Link to={`/user/${data.author.username}`} className="flex items-center gap-2 text-xs hover:text-[var(--ogoj-primary)]">
                {data.author.avatar ? (
                  <img src={data.author.avatar} className="h-8 w-8 rounded-full object-cover" alt="" />
                ) : (
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-primary">
                    {data.author.displayName.slice(0, 1)}
                  </span>
                )}
                {data.author.displayName}
              </Link>
            ) : (
              <p className="text-xs text-slate-500">未知作者</p>
            )}
            <p className="text-[11px] text-slate-400">
              发布于 {data.publishedAt ? new Date(data.publishedAt).toLocaleString() : '尚未发布'}
            </p>
          </div>
          {data.notes ? (
            <div className="card space-y-2 p-4">
              <h2 className="text-sm font-semibold">作者备注（仅自己可见）</h2>
              <p className="whitespace-pre-wrap text-xs text-slate-500">{data.notes}</p>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
