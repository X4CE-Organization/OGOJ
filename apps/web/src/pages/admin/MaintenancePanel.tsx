import { useCallback, useEffect, useState } from 'react';
import { Database, Download, Eraser, Megaphone, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { formatBytes, formatTime } from '../../lib/format';
import { EmptyState, Field, Loading, Section } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function MaintenancePanel() {
  const [sms, setSms] = useState<any>(null);
  const [smsPhone, setSmsPhone] = useState('');
  const [smsResult, setSmsResult] = useState('');

  useEffect(() => {
    api.get<any>('/api/admin/sms/status').then(setSms).catch(() => undefined);
  }, []);

  const sendTestSms = async () => {
    try {
      const result = await api.post<any>('/api/admin/sms/test', { phone: smsPhone.trim() });
      setSmsResult(result.dev ? `开发模式验证码：${result.code}` : result.message);
      toast.success(result.dev ? '短信服务未启用，已生成验证码' : '测试短信已发送');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发送失败');
    }
  };
  const toast = useToast();
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [broadcast, setBroadcast] = useState({ title: '', content: '', role: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInfo(await api.get<any>('/api/admin/maintenance/info'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const backup = async () => {
    try {
      const result = await api.post<{ file: string }>('/api/admin/backups');
      toast.success(`备份完成：${result.file}`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '备份失败');
    }
  };

  const vacuum = async () => {
    if (!window.confirm('整理数据库可能耗时较长，确定继续吗？')) return;
    try {
      await api.post('/api/admin/maintenance/vacuum');
      toast.success('数据库已整理');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '整理失败');
    }
  };

  const cleanup = async () => {
    if (!window.confirm(`确定清理 ${days} 天前的评测详情吗？此操作不可恢复。`)) return;
    try {
      const result = await api.post<{ affected: number }>('/api/admin/maintenance/cleanup', { days });
      toast.success(`已清理 ${result.affected} 条评测详情`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清理失败');
    }
  };

  const sendBroadcast = async () => {
    if (!broadcast.title.trim()) {
      toast.error('请填写公告标题');
      return;
    }
    try {
      const result = await api.post<{ sent: number }>('/api/admin/broadcast', broadcast);
      toast.success(`已发送给 ${result.sent} 位用户`);
      setBroadcast({ title: '', content: '', role: '' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发送失败');
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">备份与维护</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="数据库信息">
          <dl className="space-y-2 p-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">数据库大小</dt>
              <dd>{formatBytes(info?.database?.size ?? 0)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">日志模式</dt>
              <dd>{info?.database?.journalMode}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">服务运行时长</dt>
              <dd>{Math.floor((info?.uptime ?? 0) / 60)} 分钟</dd>
            </div>
          </dl>
          <div className="max-h-72 overflow-y-auto border-t border-slate-100 p-4 dark:border-slate-800">
            <table className="table-base">
              <thead>
                <tr>
                  <th>数据表</th>
                  <th className="w-24">记录数</th>
                </tr>
              </thead>
              <tbody>
                {(info?.database?.tables ?? []).map((table: any) => (
                  <tr key={table.table}>
                    <td className="font-mono text-xs">{table.table}</td>
                    <td className="text-xs">{table.rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="space-y-4">
          <Section title="备份">
            <div className="space-y-3 p-4">
              <button type="button" className="btn-primary w-full" onClick={backup}>
                <Database className="h-4 w-4" /> 立即备份数据库
              </button>
              {!info?.backups?.length ? (
                <EmptyState title="还没有备份文件" />
              ) : (
                <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  {info.backups.map((file: any) => (
                    <li key={file.file} className="flex items-center justify-between py-2">
                      <span className="font-mono text-xs">{file.file}</span>
                      <span className="text-xs text-slate-400">
                        {formatBytes(file.size)} · {formatTime(file.created_at, false)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-slate-400">
                备份文件保存在服务器 data/backups 目录，恢复时请停止服务后用备份文件替换 data/ogoj.db。记得同时备份 data/testdata。
              </p>
            </div>
          </Section>

          <Section title="维护操作">
            <div className="space-y-3 p-4">
              <div className="flex items-end gap-2">
                <Field label="清理早于（天）的评测详情">
                  <input
                    className="input !w-full sm:!w-32"
                    type="number"
                    value={days}
                    onChange={(event) => setDays(Number(event.target.value))}
                  />
                </Field>
                <button type="button" className="btn-ghost" onClick={cleanup}>
                  <Eraser className="h-4 w-4" /> 清理
                </button>
              </div>
              <button type="button" className="btn-ghost w-full" onClick={vacuum}>
                <Upload className="h-4 w-4 rotate-180" /> 整理数据库（VACUUM）
              </button>
              <a href="/api/admin/settings/export" className="btn-ghost w-full">
                <Download className="h-4 w-4" /> 导出系统设置
              </a>
            </div>
          </Section>
        </div>
      </div>

      <Section title="短信服务">
        <div className="space-y-3 p-4 text-sm">
          <dl className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-slate-500">服务商</dt>
              <dd>{sms?.provider ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">状态</dt>
              <dd className={sms?.enabled ? 'text-emerald-600' : 'text-amber-600'}>
                {sms?.enabled ? '已启用' : '未启用（开发模式）'}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input !w-full sm:!w-48"
              value={smsPhone}
              onChange={(event) => setSmsPhone(event.target.value)}
              placeholder="手机号，发测试短信"
            />
            <button type="button" className="btn-ghost text-xs" onClick={sendTestSms}>
              发送测试短信
            </button>
          </div>
          {smsResult && <p className="font-mono text-xs text-primary">{smsResult}</p>}
          <p className="text-xs text-slate-500">
            在 系统设置 → 短信 / 手机号 里可以选择阿里云、腾讯云或自定义 HTTP 网关；
            不配置时验证码会写进日志与站内信，方便本地调试。
          </p>
        </div>
      </Section>

      <Section title="全站广播">
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
          <Field label="标题" required>
            <input
              className="input"
              value={broadcast.title}
              onChange={(event) => setBroadcast({ ...broadcast, title: event.target.value })}
            />
          </Field>
          <Field label="发送对象">
            <select
              className="input"
              value={broadcast.role}
              onChange={(event) => setBroadcast({ ...broadcast, role: event.target.value })}
            >
              <option value="">全部用户</option>
              <option value="user">仅普通用户</option>
              <option value="admin">仅普通管理员</option>
              <option value="superadmin">仅超级管理员</option>
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label="内容">
              <textarea
                className="input min-h-[120px]"
                value={broadcast.content}
                onChange={(event) => setBroadcast({ ...broadcast, content: event.target.value })}
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <button type="button" className="btn-primary" onClick={sendBroadcast}>
              <Megaphone className="h-4 w-4" /> 发送站内信
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}
