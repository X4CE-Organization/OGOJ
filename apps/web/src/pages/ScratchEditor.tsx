import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Save, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';

interface SavePayload {
  bytes: ArrayBuffer;
  thumbnail: string;
  title: string;
}

/**
 * Scratch 创作页。
 *
 * 编辑器跑在 iframe 里（自托管的 MIT Scratch），通过 postMessage 交换数据：
 * 保存时向编辑器要 sb3 字节和封面，再 POST 到后端。
 */
export default function ScratchEditor() {
  const { user, settings } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const projectId = params.get('id') ?? '';
  const frameRef = useRef<HTMLIFrameElement>(null);
  const pending = useRef<Map<string, (payload: SavePayload) => void>>(new Map());
  const pendingReject = useRef<Map<string, (error: Error) => void>>(new Map());
  const dirty = useRef(false);

  const [title, setTitle] = useState('未命名作品');
  const [instructions, setInstructions] = useState('');
  const [savedId, setSavedId] = useState<string>(projectId);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirtyFlag, setDirtyFlag] = useState(false);
  const [status, setStatus] = useState<{ canCreate: boolean; enabled: boolean; needReview: boolean; notice: string }>({
    canCreate: false,
    enabled: true,
    needReview: false,
    notice: '',
  });

  const frameSrc = projectId ? `/scratch-editor/index.html?project=/api/scratch/projects/${projectId}/file` : '/scratch-editor/index.html';

  /** 让编辑器导出当前项目 */
  const requestSave = useCallback((): Promise<SavePayload> => {
    const target = frameRef.current?.contentWindow;
    if (!target) return Promise.reject(new Error('编辑器还没准备好'));
    const requestId = `save-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise<SavePayload>((resolve, reject) => {
      pending.current.set(requestId, resolve);
      pendingReject.current.set(requestId, reject);
      target.postMessage({ type: 'scratch:request-save', requestId }, '*');
      window.setTimeout(() => {
        if (!pending.current.has(requestId)) return;
        pending.current.delete(requestId);
        pendingReject.current.delete(requestId);
        reject(new Error('导出超时，请重试'));
      }, 20000);
    });
  }, []);

  useEffect(() => {
    void api
      .get<any>('/api/scratch/status')
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (projectId) {
      void api
        .get<any>(`/api/scratch/projects/${projectId}`)
        .then((data) => {
          setTitle(data.title);
          setInstructions(data.instructions ?? '');
        })
        .catch(() => undefined);
    }
  }, [projectId]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data ?? {};
      if (!event.origin.startsWith(window.location.origin)) return;
      if (data.type === 'scratch:ready') setReady(true);
      if (data.type === 'scratch:changed') {
        dirty.current = true;
        setDirtyFlag(true);
      }
      if (data.type === 'scratch:save-data') {
        const resolve = pending.current.get(data.requestId);
        if (resolve) {
          pending.current.delete(data.requestId);
          pendingReject.current.delete(data.requestId);
          resolve({ bytes: data.bytes, thumbnail: data.thumbnail, title: data.title });
        }
      }
      if (data.type === 'scratch:error') {
        const reject = pendingReject.current.get(data.requestId);
        if (reject) {
          pending.current.delete(data.requestId);
          pendingReject.current.delete(data.requestId);
          reject(new Error(data.message || '编辑器出错'));
        }
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  async function save(andPublish = false) {
    if (!user) {
      toast.push('请先登录', 'info');
      return;
    }
    setSaving(true);
    try {
      const payload = await requestSave();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('作品读取失败'));
        reader.readAsDataURL(new Blob([payload.bytes], { type: 'application/octet-stream' }));
      });
      const result = await api.post<{ id: number; state: string }>('/api/scratch/projects', {
        id: savedId ? Number(savedId) : undefined,
        title: title.trim() || '未命名作品',
        instructions: instructions.trim(),
        file: base64,
        thumbnail: payload.thumbnail,
      });
      setSavedId(String(result.id));
      dirty.current = false;
      setDirtyFlag(false);
      if (andPublish) {
        const published = await api.post<{ state: string }>(`/api/scratch/projects/${result.id}/publish`);
        toast.success(published.state === 'pending' ? '已保存并提交审核' : '已保存并发布到作品中心');
        navigate(`/scratch/${result.id}`);
        return;
      }
      toast.success('已保存');
      if (!projectId) navigate(`/scratch/new?id=${result.id}`, { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (!status.enabled) {
    return (
      <div className="card p-8 text-center text-sm text-slate-500">
        管理员已关闭 Scratch 作品功能。
        <div className="mt-3">
          <Link to="/scratch" className="btn-ghost text-xs">
            返回作品中心
          </Link>
        </div>
      </div>
    );
  }

  if (!status.canCreate) {
    return (
      <div className="card p-8 text-center text-sm text-slate-500">
        当前不能创作作品。
        <div className="mt-3">
          <Link to="/scratch" className="btn-ghost text-xs">
            去作品中心看看
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <Link to="/scratch" className="btn-ghost text-xs">
          <ArrowLeft className="h-4 w-4" />
          作品中心
        </Link>
        <input
          className="input !w-full sm:!w-64"
          value={title}
          maxLength={80}
          onChange={(event) => {
            setTitle(event.target.value);
            dirty.current = true;
            setDirtyFlag(true);
          }}
          placeholder="作品名称"
        />
        <input
          className="input !w-full sm:!w-80"
          value={instructions}
          maxLength={200}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="一句话玩法说明（可选）"
        />
        <div className="flex flex-wrap items-center gap-2 md:ml-auto">
          {dirtyFlag ? <span className="text-[11px] text-amber-600">有未保存的改动</span> : null}
          <button className="btn-ghost text-xs" disabled={!ready || saving} onClick={() => save(false)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存
          </button>
          <button className="btn-primary text-xs" disabled={!ready || saving} onClick={() => save(true)}>
            <Upload className="h-4 w-4" />
            保存并发布
          </button>
        </div>
      </div>

      {status.notice ? <p className="text-xs text-slate-500 dark:text-slate-400">{status.notice}</p> : null}

      <div className="card relative overflow-hidden p-0">
        {!ready ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-white/70 text-sm text-slate-500 dark:bg-slate-900/70">
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载 Scratch 编辑器…
            </span>
          </div>
        ) : null}
        <iframe
          ref={frameRef}
          src={frameSrc}
          title="Scratch 编辑器"
          className="h-[78vh] min-h-[560px] w-full border-0"
          allow="microphone; camera; clipboard-write; fullscreen"
        />
      </div>
    </div>
  );
}
