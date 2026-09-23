import { useCallback, useEffect, useState } from 'react';
import { api, query } from '../../lib/api';
import { classNames, formatTime } from '../../lib/format';
import { EmptyState, Loading, Pagination, Tabs } from '../../components/ui';

export default function LogsPanel() {
  const [tab, setTab] = useState('audit');
  const [data, setData] = useState<any>(null);
  const [logins, setLogins] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'audit') {
        setData(await api.get<any>(`/api/admin/audit-logs${query({ page, size: 50, action })}`));
      } else {
        setLogins(await api.get<any>(`/api/admin/login-logs${query({ page, size: 50 })}`));
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [tab, page, action]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">日志</h1>

      <div className="card overflow-hidden">
        <Tabs
          active={tab}
          onChange={(next) => {
            setTab(next);
            setPage(1);
          }}
          tabs={[
            { key: 'audit', label: '管理操作日志' },
            { key: 'login', label: '登录日志' },
          ]}
        />

        <div className="p-3">
          {tab === 'audit' && (
            <input
              className="input !w-64"
              placeholder="按操作类型筛选，例如 settings / problem"
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setPage(1);
              }}
            />
          )}
        </div>

        {loading ? (
          <Loading />
        ) : tab === 'audit' ? (
          !data?.items?.length ? (
            <EmptyState title="暂无日志" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="w-32">时间</th>
                    <th className="w-28">操作者</th>
                    <th className="w-48">操作</th>
                    <th className="w-40">目标</th>
                    <th>详情</th>
                    <th className="w-32">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((log: any) => (
                    <tr key={log.id}>
                      <td className="text-xs text-slate-500">{formatTime(log.created_at)}</td>
                      <td className="text-xs">{log.actor_name}</td>
                      <td className="font-mono text-xs">{log.action}</td>
                      <td className="text-xs text-slate-500">
                        {log.target_type}
                        {log.target_id ? ` #${log.target_id}` : ''}
                      </td>
                      <td className="max-w-md truncate text-xs text-slate-500" title={log.detail}>
                        {log.detail}
                      </td>
                      <td className="font-mono text-xs text-slate-400">{log.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : !logins?.items?.length ? (
          <EmptyState title="暂无登录记录" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-32">时间</th>
                  <th className="w-40">账号</th>
                  <th className="w-32">结果</th>
                  <th className="w-40">IP</th>
                </tr>
              </thead>
              <tbody>
                {logins.items.map((log: any) => (
                  <tr key={log.id}>
                    <td className="text-xs text-slate-500">{formatTime(log.created_at)}</td>
                    <td className="text-sm">{log.username}</td>
                    <td>
                      <span
                        className={classNames(
                          'rounded px-1.5 text-xs',
                          log.success
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
                        )}
                      >
                        {log.success ? '成功' : '失败'}
                      </span>
                    </td>
                    <td className="font-mono text-xs text-slate-400">{log.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          size={50}
          total={(tab === 'audit' ? data?.total : logins?.total) ?? 0}
          onChange={setPage}
        />
      </div>
    </div>
  );
}
