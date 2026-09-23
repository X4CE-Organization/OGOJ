import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../lib/api';
import { formatBytes, fromNow } from '../../lib/format';
import { EmptyState, Loading, Section } from '../../components/ui';

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<any>('/api/admin/dashboard')
      .then(setData)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (!data) return <EmptyState title="无法加载控制面板数据" />;

  const cards = [
    { label: '用户总数', value: data.users.total, sub: `今日新增 ${data.users.newToday} · 封禁 ${data.users.banned}`, to: '/admin/users' },
    { label: '题目总数', value: data.problems.total, sub: `公开 ${data.problems.public} · 待审 ${data.problems.pending}`, to: '/admin/problems' },
    { label: '提交总数', value: data.submissions.total, sub: `今日 ${data.submissions.today} · 队列 ${data.submissions.waiting}`, to: '/admin/judge' },
    { label: '比赛总数', value: data.contests.total, sub: `进行中 ${data.contests.running} · 待审 ${data.contests.pending}`, to: '/admin/contests' },
    { label: '讨论帖', value: data.community.discussions, sub: `回复 ${data.community.replies}`, to: '/admin/discussions' },
    { label: '待处理订单', value: data.shop.pendingOrders, sub: `累计订单 ${data.shop.orders}`, to: '/admin/orders' },
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold">控制面板</h1>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.label} to={card.to} className="card p-4 transition hover:shadow-md">
            <div className="text-xs text-slate-400">{card.label}</div>
            <div className="mt-1 text-2xl font-bold text-primary">{card.value}</div>
            <div className="mt-1 text-xs text-slate-500">{card.sub}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Section title="近 14 天评测趋势">
          <div className="p-3">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={data.trend}>
                <defs>
                  <linearGradient id="submissions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="accepted" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="submissions" name="提交" stroke="#0ea5e9" fill="url(#submissions)" />
                <Area type="monotone" dataKey="accepted" name="通过" stroke="#22c55e" fill="url(#accepted)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="评测机">
          <dl className="space-y-2 p-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">等待队列</dt>
              <dd className="font-medium">{data.system.judge.waiting}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">正在评测</dt>
              <dd className="font-medium">{data.system.judge.judging}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">并发数</dt>
              <dd>{data.system.judge.concurrency}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">工作线程</dt>
              <dd>{data.system.worker.running ? `运行中（${data.system.worker.active} 个任务）` : '未启动'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">数据库大小</dt>
              <dd>{formatBytes(data.system.dbSize)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Node / SQLite</dt>
              <dd className="text-xs">
                {data.system.nodeVersion} / {data.system.sqliteVersion}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">运行时长</dt>
              <dd>{Math.floor(data.system.uptime / 60)} 分钟</dd>
            </div>
          </dl>
          <div className="border-t border-slate-100 p-3 text-xs dark:border-slate-800">
            <div className="mb-1 text-slate-500">可用语言</div>
            <div className="flex flex-wrap gap-1">
              {data.system.languages.map((language: string) => (
                <span key={language} className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                  {language}
                </span>
              ))}
            </div>
          </div>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="提交最多的题目">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.topProblems.map((problem: any) => (
              <li key={problem.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-16 font-mono text-xs text-slate-400">{problem.pid}</span>
                <Link to={`/problem/${problem.pid}`} className="flex-1 truncate hover:text-primary">
                  {problem.title}
                </Link>
                <span className="text-xs text-slate-500">{problem.submissions} 次提交</span>
              </li>
            ))}
            {!data.topProblems.length && <EmptyState title="暂无数据" />}
          </ul>
        </Section>

        <Section title="最近的管理操作">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.recentActions.map((action: any) => (
              <li key={action.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                <span className="font-mono text-slate-400">{action.action}</span>
                <span className="flex-1 truncate text-slate-500">
                  {action.target_type}
                  {action.target_id ? ` #${action.target_id}` : ''}
                </span>
                <span className="text-slate-400">{action.actor_name}</span>
                <span className="text-slate-400">{fromNow(action.created_at)}</span>
              </li>
            ))}
            {!data.recentActions.length && <EmptyState title="暂无操作记录" />}
          </ul>
        </Section>
      </div>
    </div>
  );
}
