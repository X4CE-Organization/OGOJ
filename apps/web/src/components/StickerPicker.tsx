import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Plus, Search, Smile, Star, Trash2, Upload } from 'lucide-react';
import { api, query } from '../lib/api';
import { classNames } from '../lib/format';
import { useAuth } from '../lib/auth';
import { stickerMarkdown } from '../lib/insert';
import { useToast } from './Toast';

export interface Sticker {
  id: number;
  name: string;
  pack: string;
  url: string;
  isPublic: boolean;
  useCount: number;
  mine: boolean;
  collected: boolean;
}

const SCOPES = [
  { key: 'mine', label: '我的' },
  { key: 'favorites', label: '收藏' },
  { key: 'public', label: '公共' },
] as const;

/**
 * 表情包选择器：点表情图标弹出面板，选一个就插入到输入框。
 * 面板里还能直接上传新表情、收藏别人的表情。
 */
export default function StickerPicker({
  onPick,
  className,
}: {
  onPick: (markdown: string, sticker: Sticker) => void;
  className?: string;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<(typeof SCOPES)[number]['key']>('mine');
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<Sticker[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; up: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await api.get<{ items: Sticker[] }>(`/api/stickers${query({ scope, q: keyword })}`);
      setItems(data.items ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [scope, keyword, user]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onReflow = () => place();
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 320;
    const height = 340;
    const left = Math.min(Math.max(8, rect.right - width), Math.max(8, window.innerWidth - width - 8));
    const up = rect.bottom + height > window.innerHeight;
    const top = up ? Math.max(8, rect.top - height - 6) : rect.bottom + 6;
    setPosition({ top, left, up });
  };

  const pick = (sticker: Sticker) => {
    onPick(stickerMarkdown(sticker), sticker);
    void api.post(`/api/stickers/${sticker.id}/use`).catch(() => undefined);
  };

  const toggleCollect = async (sticker: Sticker) => {
    try {
      if (sticker.collected) await api.del(`/api/stickers/${sticker.id}/collect`);
      else await api.post(`/api/stickers/${sticker.id}/collect`);
      setItems((current) =>
        current.map((item) => (item.id === sticker.id ? { ...item, collected: !item.collected } : item)),
      );
      toast.success(sticker.collected ? '已取消收藏' : '已收藏到我的表情');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const upload = async (file: File) => {
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || '表情';
    try {
      const form = new FormData();
      form.append('file', file);
      await api.post(`/api/stickers${query({ name, pack: '默认', public: 1 })}`, form);
      toast.success('表情已上传');
      setScope('mine');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    }
  };

  const removeSticker = async (sticker: Sticker) => {
    if (!window.confirm(`删除表情「${sticker.name}」？`)) return;
    try {
      await api.del(`/api/stickers/${sticker.id}`);
      setItems((current) => current.filter((item) => item.id !== sticker.id));
      toast.success('已删除');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  if (!user) return null;

  return (
    <div ref={boxRef} className={classNames('relative inline-block', className)}>
      <button
        ref={buttonRef}
        type="button"
        title="表情包"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-primary dark:hover:bg-slate-800"
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          place();
          setOpen(true);
        }}
      >
        <Smile className="h-4 w-4" />
      </button>

      {open && (
        <div
          className="fixed z-[999] w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-800"
          style={position ? { top: position.top, left: position.left } : undefined}
        >
          <div className="mb-2 flex items-center gap-1">
            {SCOPES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setScope(item.key)}
                className={classNames(
                  'rounded-lg px-2 py-1 text-xs',
                  scope === item.key
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700',
                )}
              >
                {item.label}
              </button>
            ))}
            <Link
              to="/stickers"
              className="ml-auto text-[11px] text-slate-400 hover:text-primary"
              onClick={() => setOpen(false)}
            >
              管理表情包
            </Link>
          </div>

          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              className="input !py-1 pl-7 text-xs"
              placeholder="搜索表情名称 / 分组"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>

          <div className="scrollbar-thin grid max-h-56 grid-cols-4 gap-2 overflow-y-auto">
            {loading ? (
              <p className="col-span-4 py-6 text-center text-xs text-slate-400">加载中…</p>
            ) : items.length === 0 ? (
              <p className="col-span-4 py-6 text-center text-xs text-slate-400">
                {scope === 'mine' ? '还没有表情，点下面的按钮上传一张' : '这里还没有表情'}
              </p>
            ) : (
              items.map((sticker) => (
                <div key={sticker.id} className="group relative">
                  <button
                    type="button"
                    title={`${sticker.name}${sticker.pack ? ` · ${sticker.pack}` : ''}`}
                    className="flex h-16 w-full items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 transition hover:border-primary dark:border-slate-700 dark:bg-slate-900"
                    onClick={() => pick(sticker)}
                  >
                    <img src={sticker.url} alt={sticker.name} className="max-h-16 max-w-full object-contain" loading="lazy" />
                  </button>
                  <div className="absolute right-0.5 top-0.5 hidden gap-0.5 group-hover:flex">
                    {!sticker.mine && (
                      <button
                        type="button"
                        title={sticker.collected ? '取消收藏' : '收藏到我的表情'}
                        className="rounded bg-white/90 p-1 text-slate-500 shadow hover:text-rose-500 dark:bg-slate-800/90"
                        onClick={() => void toggleCollect(sticker)}
                      >
                        {sticker.collected ? <Heart className="h-3 w-3 fill-rose-500 text-rose-500" /> : <Heart className="h-3 w-3" />}
                      </button>
                    )}
                    {sticker.mine && (
                      <button
                        type="button"
                        title="删除"
                        className="rounded bg-white/90 p-1 text-slate-500 shadow hover:text-rose-500 dark:bg-slate-800/90"
                        onClick={() => void removeSticker(sticker)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2 dark:border-slate-700">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-xs text-primary">
              <Upload className="h-3.5 w-3.5" /> 上传表情
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = '';
                }}
              />
            </label>
            <span className="text-[11px] text-slate-400">支持 jpg / png / gif / webp，5 MB 以内</span>
            <Link to="/stickers" className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-primary" onClick={() => setOpen(false)}>
              <Plus className="h-3 w-3" /> 分组管理
            </Link>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
            <Star className="h-3 w-3" /> 公共表情可以收藏成自己的
          </div>
        </div>
      )}
    </div>
  );
}
