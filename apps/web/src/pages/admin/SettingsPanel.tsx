import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { classNames } from '../../lib/format';
import { Loading, Section } from '../../components/ui';
import { useToast } from '../../components/Toast';
import ImageUploadField from '../../components/ImageUploadField';
import ColorPicker from '../../components/ColorPicker';

interface Field {
  key: string;
  label: string;
  type: 'string' | 'text' | 'number' | 'boolean' | 'select' | 'color' | 'password' | 'json' | 'image';
  default: unknown;
  group: string;
  description?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  public?: boolean;
  secret?: boolean;
  placeholder?: string;
  uploadCategory?: string;
}

interface Group {
  key: string;
  name: string;
  description: string;
}

export default function SettingsPanel() {
  const { refreshMeta } = useAuth();
  const toast = useToast();
  const [fields, setFields] = useState<Field[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [values, setValues] = useState<Record<string, any>>({});
  const [dirty, setDirty] = useState<Record<string, any>>({});
  const [active, setActive] = useState('site');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  const load = async () => {
    try {
      const data = await api.get<any>('/api/admin/settings');
      setFields(data.fields);
      setGroups(data.groups);
      setValues(data.values);
      setDirty({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = (field: Field) => (field.key in dirty ? dirty[field.key] : values[field.key]);

  const setValue = (field: Field, value: unknown) => {
    setDirty((currentDirty) => ({ ...currentDirty, [field.key]: value }));
  };

  const visibleFields = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return fields.filter((field) => {
      if (term) {
        return (
          field.label.toLowerCase().includes(term) ||
          field.key.toLowerCase().includes(term) ||
          (field.description ?? '').toLowerCase().includes(term)
        );
      }
      return field.group === active;
    });
  }, [fields, filter, active]);

  const save = async () => {
    if (!Object.keys(dirty).length) {
      toast.push('没有需要保存的修改', 'info');
      return;
    }
    setSaving(true);
    try {
      const result = await api.put<any>('/api/admin/settings', { values: dirty });
      toast.success(`已保存 ${result.changed.length} 项设置`);
      setValues(result.values);
      setDirty({});
      await refreshMeta();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const resetGroup = async () => {
    if (!window.confirm(`确定要将「${groups.find((group) => group.key === active)?.name}」的所有设置恢复默认值吗？`)) return;
    const keys = fields.filter((field) => field.group === active).map((field) => field.key);
    try {
      await api.post('/api/admin/settings/reset', { keys });
      toast.success('已恢复默认值');
      await load();
      await refreshMeta();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重置失败');
    }
  };

  const exportSettings = async () => {
    const response = await fetch('/api/admin/settings/export', {
      credentials: 'include',
      headers: { Authorization: `Bearer ${localStorage.getItem('ogoj-token') ?? ''}` },
    });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ogoj-settings.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">系统设置</h1>
        <div className="flex items-center gap-2">
          <input
            className="input !w-56"
            placeholder="搜索设置项…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={exportSettings}>
            导出配置
          </button>
          <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={resetGroup}>
            恢复本组默认
          </button>
          <button type="button" className="btn-primary !py-1.5 text-xs" disabled={saving} onClick={save}>
            {saving ? '保存中…' : `保存修改${Object.keys(dirty).length ? `（${Object.keys(dirty).length}）` : ''}`}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <nav className="card h-fit space-y-0.5 p-2">
          {groups.map((group) => {
            const count = fields.filter((field) => field.group === group.key).length;
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => {
                  setActive(group.key);
                  setFilter('');
                }}
                className={classNames(
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm',
                  active === group.key && !filter
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                <span>{group.name}</span>
                <span className="text-[11px] text-slate-400">{count}</span>
              </button>
            );
          })}
        </nav>

        <Section
          title={
            filter
              ? `搜索结果（${visibleFields.length}）`
              : groups.find((group) => group.key === active)?.description
          }
        >
          <div className="grid gap-4 p-4 md:grid-cols-2">
            {visibleFields.map((field) => {
              const value = current(field);
              return (
                <div key={field.key} className={classNames(field.type === 'json' || field.type === 'text' ? 'md:col-span-2' : '')}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{field.label}</span>
                    <code className="text-[11px] text-slate-400">{field.key}</code>
                    {field.public && (
                      <span className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                        前台可见
                      </span>
                    )}
                    {field.secret && (
                      <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                        保密
                      </span>
                    )}
                  </div>
                  {field.type === 'boolean' ? (
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-500">
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(event) => setValue(field, event.target.checked)}
                      />
                      {value ? '已启用' : '已关闭'}
                    </label>
                  ) : field.type === 'select' ? (
                    <select
                      className="input"
                      value={String(value ?? '')}
                      onChange={(event) => setValue(field, event.target.value)}
                    >
                      {(field.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'number' ? (
                    <input
                      className="input"
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step ?? 1}
                      value={value === undefined || value === null ? '' : String(value)}
                      onChange={(event) => setValue(field, Number(event.target.value))}
                    />
                  ) : field.type === 'json' ? (
                    <textarea
                      className="input min-h-[80px] font-mono text-xs"
                      value={typeof value === 'string' ? value : JSON.stringify(value ?? [], null, 2)}
                      onChange={(event) => setValue(field, event.target.value)}
                    />
                  ) : field.type === 'text' ? (
                    <textarea
                      className="input min-h-[100px]"
                      value={String(value ?? '')}
                      onChange={(event) => setValue(field, event.target.value)}
                    />
                  ) : field.type === 'image' ? (
                    <ImageUploadField
                      value={String(value ?? '')}
                      onChange={(next) => setValue(field, next)}
                      category={field.uploadCategory ?? 'site'}
                      placeholder={field.placeholder ?? '/uploads/site/xxx.png'}
                    />
                  ) : field.type === 'color' ? (
                    <div className="flex items-center gap-2">
                      <ColorPicker
                        value={String(value ?? '#0ea5e9')}
                        title={field.label ?? '选择颜色'}
                        onChange={(color) => setValue(field, color || '#0ea5e9')}
                      />
                      <input
                        className="input"
                        value={String(value ?? '')}
                        onChange={(event) => setValue(field, event.target.value)}
                      />
                    </div>
                  ) : (
                    <input
                      className="input"
                      type={field.type === 'password' ? 'password' : 'text'}
                      value={String(value ?? '')}
                      placeholder={field.placeholder}
                      onChange={(event) => setValue(field, event.target.value)}
                    />
                  )}
                  {field.description && <p className="mt-1 text-xs text-slate-400">{field.description}</p>}
                  {field.min !== undefined && field.max !== undefined && (
                    <p className="text-[11px] text-slate-400">
                      取值范围：{field.min} ~ {field.max}
                    </p>
                  )}
                </div>
              );
            })}
            {visibleFields.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400 md:col-span-2">没有匹配的设置项</p>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
