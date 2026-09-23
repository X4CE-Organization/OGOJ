import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, RefreshCw, Sparkles, Trophy } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames } from '../lib/format';
import { Avatar, EmptyState, Loading, Section, Tabs, UserLink } from '../components/ui';
import { useToast } from '../components/Toast';

const RARITY: Record<string, { label: string; ring: string; text: string }> = {
  common: { label: '普通', ring: 'ring-slate-300 dark:ring-slate-600', text: 'text-slate-500' },
  rare: { label: '稀有', ring: 'ring-sky-400', text: 'text-sky-600 dark:text-sky-400' },
  epic: { label: '史诗', ring: 'ring-violet-400', text: 'text-violet-600 dark:text-violet-400' },
  legendary: { label: '传说', ring: 'ring-amber-400', text: 'text-amber-600 dark:text-amber-400' },
};

const CATEGORY_NAMES: Record<string, string> = {
  milestone: '里程碑',
  skill: '实力',
  contest: '比赛',
  community: '社区',
  special: '特殊',
};

interface Badge {
  id: number;
  code: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  rarity: string;
  points: number;
  unlocked: boolean;
  unlockedAt: string | null;
  progress: number;
  target: number;
  holderCount: number;
}

export default function Achievements() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [rank, setRank] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>('/api/achievements');
      setData(result);
      const ranking = await api.get<any>('/api/achievements/rank');
      setRank(ranking.items ?? []);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const check = async () => {
    try {
      const result = await api.post<{ unlocked: any[] }>('/api/achievements/check');
      if (result.unlocked.length) {
        toast.success(`恭喜解锁 ${result.unlocked.length} 个新成就！`);
        void load();
      } else {
        toast.push('暂时没有新的成就，继续加油！', 'info');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  if (loading) return <Loading />;
  if (!data) return <EmptyState title="无法加载成就数据" />;

  const items: Badge[] = data.items;
  const categories = ['all', ...data.categories];
  const visible = tab === 'all' ? items : items.filter((item) => item.category === tab);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Award className="h-5 w-5 text-primary" /> 成就徽章
        </h1>
        <div className="flex items-center gap-3">
          {user && (
            <span className="text-sm text-slate-500">
              已解锁 <b className="text-primary">{data.unlockedCount}</b> / {data.total}
            </span>
          )}
          {user && (
            <button type="button" className="btn-primary !py-1.5 text-xs" onClick={check}>
              <RefreshCw className="h-3.5 w-3.5" /> 检查我的成就
            </button>
          )}
          {isAdmin && (
            <Link to="/admin/achievements" className="btn-ghost !py-1.5 text-xs">
              管理成就
            </Link>
          )}
        </div>
      </div>

      {user && (
        <div className="card flex flex-wrap items-center gap-4 p-4">
          <Avatar user={user} size={52} />
          <div className="flex-1">
            <div className="text-sm font-medium">{user.display_name || user.username} 的成就进度</div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${data.total ? (data.unlockedCount / data.total) * 100 : 0}%` }}
              />
            </div>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>解锁率 {data.total ? Math.round((data.unlockedCount / data.total) * 100) : 0}%</div>
            <div className="mt-0.5">
              徽章奖励积分{' '}
              {items.filter((item) => item.unlocked).reduce((sum, item) => sum + item.points, 0)}
            </div>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={categories.map((category) => ({
            key: category,
            label: category === 'all' ? '全部' : CATEGORY_NAMES[category] ?? category,
            badge:
              category === 'all'
                ? items.length
                : items.filter((item) => item.category === category).length,
          }))}
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((badge) => {
            const rarity = RARITY[badge.rarity] ?? RARITY.common!;
            const locked = !badge.unlocked && data.showLocked !== false;
            return (
              <div
                key={badge.id}
                className={classNames(
                  'rounded-xl border p-3 transition',
                  badge.unlocked
                    ? 'border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900'
                    : 'border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40',
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={classNames(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl ring-2',
                      badge.unlocked ? rarity.ring : 'ring-slate-200 grayscale dark:ring-slate-700',
                    )}
                  >
                    {badge.icon}
                  </span>
                  <div className="min-w-0">
                    <div className={classNames('truncate text-sm font-semibold', !badge.unlocked && 'text-slate-400')}>
                      {badge.name}
                    </div>
                    <div className={classNames('text-[11px]', rarity.text)}>
                      {rarity.label} · {CATEGORY_NAMES[badge.category] ?? badge.category}
                      {badge.points > 0 ? ` · +${badge.points} 分` : ''}
                    </div>
                  </div>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-slate-500">{badge.description}</p>
                {!badge.unlocked && badge.target > 1 && (
                  <div className="mt-2">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>进度</span>
                      <span>
                        {Math.min(badge.progress, badge.target)} / {badge.target}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${Math.min(100, (badge.progress / badge.target) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span>{badge.holderCount} 人获得</span>
                  {badge.unlocked && (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <Sparkles className="h-3 w-3" /> 已解锁
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {visible.length === 0 && (
            <div className="col-span-full">
              <EmptyState title="该分类下暂无徽章" />
            </div>
          )}
        </div>
      </div>

      {rank.length > 0 && (
        <Section title="成就排行榜">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {rank.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span
                  className={classNames(
                    'w-6 text-center text-xs font-semibold',
                    item.rank <= 3 ? 'text-amber-500' : 'text-slate-400',
                  )}
                >
                  {item.rank}
                </span>
                <UserLink user={item} size={24} />
                <span className="ml-auto flex items-center gap-3 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <Trophy className="h-3.5 w-3.5" />
                    {item.achievement_count} 枚
                  </span>
                  <span>奖励 {item.achievement_points} 分</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
