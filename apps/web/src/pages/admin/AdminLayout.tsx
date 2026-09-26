import { NavLink, Outlet } from 'react-router-dom';
import {
  Award,
  BookOpen,
  Database,
  FileText,
  Flag,
  GaugeCircle,
  Image,
  LifeBuoy,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Receipt,
  Settings2,
  ShoppingBag,
  Tags,
  Trophy,
  Users,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { classNames } from '../../lib/format';
import { useEffect, useState } from 'react';

const SECTIONS: { title: string; items: { to: string; label: string; icon: any; superOnly?: boolean }[] }[] = [
  {
    title: '概览',
    items: [{ to: '/admin', label: '控制面板', icon: LayoutDashboard }],
  },
  {
    title: '系统',
    items: [
      { to: '/admin/settings', label: '系统设置', icon: Settings2, superOnly: true },
      { to: '/admin/users', label: '用户管理', icon: Users },
      { to: '/admin/logs', label: '操作日志', icon: FileText, superOnly: true },
      { to: '/admin/maintenance', label: '备份与维护', icon: Database, superOnly: true },
    ],
  },
  {
    title: '内容',
    items: [
      { to: '/admin/problems', label: '题目管理', icon: BookOpen },
      { to: '/admin/contests', label: '比赛管理', icon: Trophy },
      { to: '/admin/solutions', label: '题解审核', icon: ListChecks },
      { to: '/admin/achievements', label: '成就管理', icon: Award },
      { to: '/admin/tags', label: '标签分组', icon: Tags },
      { to: '/admin/discussions', label: '帖子管理', icon: MessageSquare },
      { to: '/admin/announcements', label: '公告管理', icon: Flag },
      { to: '/admin/carousel', label: '首页轮播', icon: Image },
    ],
  },
  {
    title: '商店与评测',
    items: [
      { to: '/admin/shop', label: '商品管理', icon: ShoppingBag },
      { to: '/admin/orders', label: '订单审核', icon: Receipt },
      { to: '/admin/judge', label: '评测机状态', icon: GaugeCircle },
      { to: '/admin/tickets', label: '工单管理', icon: LifeBuoy },
    ],
  },
];

export default function AdminLayout() {
  const { isSuperAdmin, user } = useAuth();
  const [pendingTickets, setPendingTickets] = useState(0);

  useEffect(() => {
    const load = () =>
      api
        .get<any>('/api/admin/tickets?status=unfinished&size=1')
        .then((data) => setPendingTickets(data.stats?.open ?? 0))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
      <aside className="space-y-4">
        <div className="card p-3">
          <div className="px-1 pb-2 text-xs text-slate-400">
            当前身份
            <div className="mt-0.5 text-sm font-medium text-slate-700 dark:text-slate-200">
              {isSuperAdmin ? '超级管理员' : '普通管理员'}
            </div>
            <div className="text-[11px] text-slate-400">@{user?.username}</div>
          </div>
        </div>
        <nav className="card space-y-3 p-3">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {section.title}
              </div>
              <div className="space-y-0.5">
                {section.items
                  .filter((item) => !item.superOnly || isSuperAdmin)
                  .map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/admin'}
                      className={({ isActive }) =>
                        classNames(
                          'flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors',
                          isActive
                            ? 'bg-primary/10 font-medium text-primary'
                            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                        )
                      }
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                      {item.to === '/admin/tickets' && pendingTickets > 0 && (
                        <span className="ml-auto rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
                          {pendingTickets > 99 ? '99+' : pendingTickets}
                        </span>
                      )}
                    </NavLink>
                  ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
