import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Award,
  BookOpen,
  ChevronDown,
  Github,
  Home,
  LifeBuoy,
  ListChecks,
  Mail,
  Menu,
  Moon,
  Search,
  Settings,
  ShoppingBag,
  Sun,
  Trophy,
  Users,
  Users2,
  X,
} from 'lucide-react';
import { useAuth, useTheme } from '../lib/auth';
import { api } from '../lib/api';
import { classNames } from '../lib/format';
import { Avatar } from './ui';
import { useToast } from './Toast';
import Tooltip from './Tooltip';
import ImageUploadField from './ImageUploadField';
import { Modal } from './ui';

const NAV_ITEMS = [
  { to: '/', label: '首页', icon: Home },
  { to: '/problems', label: '题库', icon: BookOpen },
  { to: '/record', label: '评测记录', icon: ListChecks },
  { to: '/contests', label: '比赛', icon: Trophy },
  { to: '/training', label: '训练', icon: ListChecks },
  { to: '/teams', label: '团队', icon: Users2 },
  { to: '/discussions', label: '讨论', icon: Users },
  { to: '/articles', label: '文章广场', icon: BookOpen },
  { to: '/rank', label: '排行榜', icon: Trophy },
  { to: '/achievements', label: '成就', icon: Award },
  { to: '/shop', label: '商店', icon: ShoppingBag },
];

const GITHUB_FALLBACK = 'https://github.com/x4ce-organization/OGOJ';

function Header() {
  const { user, settings, unread, ticketUnread, isAdmin, logout, grants, refresh } = useAuth();
  const { dark, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarDraft, setAvatarDraft] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const menuRef = useRef<HTMLDivElement>(null);

  const siteName = String(settings.site_name ?? 'OGOJ');
  const githubUrl = String(settings.github_url ?? GITHUB_FALLBACK) || GITHUB_FALLBACK;
  const logo = String(settings.site_logo ?? '');

  useEffect(() => {
    setMenuOpen(false);
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const term = keyword.trim();
    if (!term) return;
    navigate(`/search?q=${encodeURIComponent(term)}`);
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4">
        <Link
          to="/"
          title={`${siteName} 首页`}
          className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-primary"
        >
          {logo ? <img src={logo} alt={siteName} className="h-7" /> : null}
          <span>{siteName}</span>
        </Link>

        <nav className="hidden flex-1 items-center gap-0.5 lg:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                classNames(
                  'rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <form onSubmit={submitSearch} className="relative ml-auto hidden md:block">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索题目 / 用户 / 讨论"
            className="input !w-56 !pl-8"
          />
        </form>

        {settings.enable_dark_mode !== false && (
          <Tooltip label={dark ? '切换到浅色模式' : '切换到深色模式'} description="切换网站配色">
            <button
              type="button"
              aria-label={dark ? '切换到浅色模式' : '切换到深色模式'}
              onClick={toggle}
              className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 sm:block dark:hover:bg-slate-800"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </Tooltip>
        )}

        {settings.show_github_link !== false && (
          <Tooltip label="开源仓库" description="在 GitHub 上查看 OGOJ 源码">
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub 仓库"
              className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 sm:block dark:hover:bg-slate-800"
            >
              <Github className="h-4 w-4" />
            </a>
          </Tooltip>
        )}

        {user ? (
          <>
            {settings.enable_tickets !== false && settings.ticket_show_entry !== false && (
              <Tooltip label="工单 · 问题反馈" description="遇到问题或想提建议，提交工单给管理员">
                <Link
                  to="/tickets"
                  aria-label="工单"
                  className="relative hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 sm:block dark:hover:bg-slate-800"
                >
                  <LifeBuoy className="h-4 w-4" />
                  {ticketUnread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
                      {ticketUnread > 99 ? '99+' : ticketUnread}
                    </span>
                  )}
                </Link>
              </Tooltip>
            )}
            <Tooltip label="站内信 · 私信" description="系统通知与用户私信都在这里">
              <Link
                to="/messages"
                aria-label="站内信"
                className="relative hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 sm:block dark:hover:bg-slate-800"
              >
                <Mail className="h-4 w-4" />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>
            </Tooltip>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Avatar user={user} size={28} />
                <span className="hidden max-w-[8rem] truncate text-sm sm:block">
                  {user.display_name || user.username}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800">
                    <div className="font-medium text-slate-700 dark:text-slate-200">
                      {user.display_name || user.username}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span>积分 {user.points}</span>
                      <span>
                        通过 {(user.solvedCount ?? user.solved_count ?? 0)} 题
                      </span>
                    </div>
                    {(grants.problem || grants.contest) && (
                      <div className="mt-1 text-emerald-600 dark:text-emerald-400">
                        可用资格：出题 {grants.problem ?? 0} · 比赛 {grants.contest ?? 0}
                      </div>
                    )}
                  </div>
                  <MenuItem to={`/user/${encodeURIComponent(user.username)}`}>个人主页</MenuItem>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                    onClick={() => {
                      setAvatarDraft(user.avatar ?? '');
                      setAvatarOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    更换头像
                  </button>
                  <MenuItem to="/settings">个人设置</MenuItem>
                  <MenuItem to="/shop/orders">我的订单</MenuItem>
                  <MenuItem to="/tickets">
                    我的工单
                    {ticketUnread > 0 && <span className="ml-1 text-rose-500">({ticketUnread})</span>}
                  </MenuItem>
                  <MenuItem to="/achievements">我的成就</MenuItem>
                  <MenuItem to="/messages">
                    站内信
                    {unread > 0 && <span className="ml-1 text-rose-500">({unread})</span>}
                  </MenuItem>
                  {isAdmin && <MenuItem to="/admin">管理控制面板</MenuItem>}
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm text-rose-600 hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={async () => {
                      await logout();
                      toast.success('已退出登录');
                      navigate('/');
                    }}
                  >
                    退出登录
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Link to="/login" className="btn-ghost">
              登录
            </Link>
            {settings.allow_register !== false && (
              <Link to="/register" className="btn-primary">
                注册
              </Link>
            )}
          </div>
        )}

        <button
          type="button"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800"
          onClick={() => setNavOpen((open) => !open)}
        >
          {navOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {navOpen && (
        <nav className="border-t border-slate-200 bg-white px-4 py-2 lg:hidden dark:border-slate-800 dark:bg-slate-900">
          <form onSubmit={submitSearch} className="relative mb-2 mt-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索"
              className="input !pl-8"
            />
          </form>
          <div className="grid grid-cols-3 gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  classNames(
                    'flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm',
                    isActive ? 'bg-primary/10 text-primary' : 'text-slate-600 dark:text-slate-300',
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}

      </header>

      <Modal
        open={avatarOpen}
        title="更换头像"
        onClose={() => setAvatarOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setAvatarOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                try {
                  await api.put('/api/auth/profile', { avatar: avatarDraft });
                  await refresh();
                  setAvatarOpen(false);
                  toast.success('头像已更新');
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : '更新失败');
                }
              }}
            >
              保存
            </button>
          </>
        }
      >
        <ImageUploadField
          value={avatarDraft}
          onChange={setAvatarDraft}
          category="avatar"
          previewClassName="h-20 w-20"
          rounded="rounded-full"
          hint="支持 jpg / png / gif / webp / svg，建议正方形图片"
        />
      </Modal>
    </>
  );
}

function MenuItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="block px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {children}
    </Link>
  );
}

function Footer() {
  const { settings } = useAuth();
  const githubUrl = String(settings.github_url ?? GITHUB_FALLBACK) || GITHUB_FALLBACK;
  const links = Array.isArray(settings.footer_links) ? (settings.footer_links as any[]) : [];
  const footerText = String(settings.footer_text ?? 'Powered by OGOJ');
  const showTickets = settings.enable_tickets !== false && settings.ticket_show_entry !== false;

  return (
    <footer className="mt-10 border-t border-slate-200 bg-white py-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 text-xs text-center">
        {showTickets && (
          <Link to="/tickets/new" className="hover:text-primary">
            提交工单
          </Link>
        )}
        {links.map((link) => (
          <Link key={String(link.href)} to={String(link.href)} className="hover:text-primary">
            {String(link.label)}
          </Link>
        ))}
        <a
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-primary hover:underline"
        >
          {footerText}
        </a>
        {settings.copyright ? <span>{String(settings.copyright)}</span> : null}
        {settings.icp_record ? (
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary"
          >
            {String(settings.icp_record)}
          </a>
        ) : null}
        {settings.police_record ? <span>{String(settings.police_record)}</span> : null}
      </div>
    </footer>
  );
}

export default function Layout() {
  const { settings } = useAuth();
  const widthClass =
    settings.layout_width === 'full'
      ? 'max-w-none'
      : settings.layout_width === 'normal'
        ? 'max-w-[1200px]'
        : 'max-w-[1440px]';
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className={classNames('mx-auto w-full flex-1 px-4 py-5', widthClass)}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
