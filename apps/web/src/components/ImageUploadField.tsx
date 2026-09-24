import { useRef, useState } from 'react';
import { Image as ImageIcon, Link2, Trash2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { classNames } from '../lib/format';
import { useToast } from './Toast';

/**
 * Image picker used by the profile settings, the admin control panel and the
 * article editor: upload a file, paste a URL, preview and clear.
 */
export default function ImageUploadField({
  value,
  onChange,
  category = 'misc',
  hint,
  previewClassName = 'h-16 w-28',
  rounded = 'rounded-lg',
  placeholder = '/uploads/xxx.png',
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  category?: string;
  hint?: string;
  previewClassName?: string;
  rounded?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const result = await api.upload<{ url: string }>(`/api/upload?category=${encodeURIComponent(category)}`, file);
      onChange(result.url);
      toast.success('图片上传成功');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <div
          className={classNames(
            'flex shrink-0 items-center justify-center overflow-hidden border border-dashed border-slate-300 bg-slate-50 text-slate-300 dark:border-slate-600 dark:bg-slate-800',
            rounded,
            previewClassName,
          )}
        >
          {value ? (
            <img src={value} alt="" className={classNames('h-full w-full object-cover', rounded)} />
          ) : (
            <ImageIcon className="h-5 w-5" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-ghost !py-1.5 text-xs"
              disabled={disabled || uploading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? '上传中…' : '上传图片'}
            </button>
            {value && (
              <button
                type="button"
                className="btn-ghost !py-1.5 text-xs text-rose-500"
                disabled={disabled}
                onClick={() => onChange('')}
              >
                <Trash2 className="h-3.5 w-3.5" /> 清除
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/x-icon"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </div>
          <div className="relative">
            <Link2 className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              className="input !pl-8 text-xs"
              value={value}
              disabled={disabled}
              placeholder={placeholder}
              onChange={(event) => onChange(event.target.value)}
            />
          </div>
        </div>
      </div>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
