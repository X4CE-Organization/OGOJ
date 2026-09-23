import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Flame, Trophy, Users2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  classNames,
  countdown,
  difficultyColor,
  formatDuration,
  formatTime,
  fromNow,
} from '../lib/format';
import { Avatar, DifficultyBadge, EmptyState, Loading, Section, TagBadge, UserLink } from '../components/ui';

interface HomeData {
  modules: string[];
  notice: string;
  carousel: { id: number; title: string; subtitle: string; image: string; link: string }[];
  announcements: any[];
  stats: Record<string, number>;
  recentProblems: any[];
  recentContests: any[];
  recentDiscussions: any[];
  ranklist: any[];
  tags: any[];
}

function Carousel({ items, interval }: { items: HomeData['carousel']; interval: number }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (items.length <= 1) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % items.length), Math.max(2, interval) * 1000);
    return () => clearInterval(timer);
  }, [items.length, interval]);
  if (!items.length) return null;
  const item = items[index]!;

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-sky-500 via-cyan-500 to-indigo-500 dark:border-slate-800">
      {item.image ? (
        <img src={item.image} alt={item.title} className="h-48 w-full object-cover sm:h-56" />
      ) : (
        <div className="flex h-48 flex-col justify-center gap-2 px-8 text-white sm:h-56">
          <h2 className="text-2xl font-bold drop-shadow sm:text-3xl">{item.title}</h2>
          <p className="max-w-2xl text-sm text-white/90 sm:text-base">{item.subtitle}</p>
          {item.link && (
            <Link
              to={item.link}
              className="mt-2 inline-flex w-fit items-center gap-1 rounded-lg bg-white/20 px-3 py-1.5 text-sm backdrop-blur hover:bg-white/30"
            >
              立即查看 <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}
      {items.length > 1 && (
        <>
          <button
            type="button"
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/25 p-1.5 text-white hover:bg-black/40"
            onClick={() => setIndex((i) => (i - 1 + items.length) % items.length)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/25 p-1.5 text-white hover:bg-black/40"
            onClick={() => setIndex((i) => (i + 1) % items.length)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
            {items.map((entry, i) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setIndex(i)}
                className={classNames(
                  'h-1.5 rounded-full transition-all',
                  i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/50',
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Home() {
  const { settings, user } = useAuth();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<HomeData>('/api/public/home')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <EmptyState title="加载失败" description={error} />;
  if (!data) return <Loading />;

  const modules = data.modules.length
    ? data.modules
    : ['carousel', 'notice', 'statistics', 'recent_problems', 'recent_contests', 'recent_discussions', 'ranklist'];
  const has = (name: string) => modules.includes(name);

  return (
    <div className="space-y-5">
      {has('carousel') && <Carousel items={data.carousel} interval={Number(settings.carousel_interval ?? 6)} />}

      {has('notice') && data.notice && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          📢 {data.notice}
        </div>
      )}

      {has('statistics') && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: '注册用户', value: data.stats.users, icon: Users2 },
            { label: '题目总数', value: data.stats.problems, icon: Flame },
            { label: '评测总数', value: data.stats.submissions, icon: Trophy },
            { label: '今日提交', value: data.stats.todaySubmissions, icon: Trophy },
          ].map((item) => (
            <div key={item.label} className="card flex items-center gap-3 px-4 py-3">
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <item.icon className="h-4 w-4" />
              </span>
              <div>
                <div className="text-lg font-semibold">{item.value ?? 0}</div>
                <div className="text-xs text-slate-500">{item.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {has('recent_problems') && (
            <Section
              title="最新题目"
              action={
                <Link to="/problems" className="text-xs text-primary hover:underline">
                  查看全部 →
                </Link>
              }
            >
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.recentProblems.map((problem) => (
                  <li key={problem.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <span className="w-16 shrink-0 font-mono text-xs text-slate-400">{problem.pid}</span>
                    <Link to={`/problem/${problem.pid}`} className="flex-1 truncate text-sm hover:text-primary">
                      {problem.title}
                    </Link>
                    <div className="hidden gap-1 sm:flex">
                      {problem.tags.slice(0, 2).map((tag: any) => (
                        <TagBadge key={tag.id} tag={tag} />
                      ))}
                    </div>
                    <DifficultyBadge value={problem.difficulty} compact />
                  </li>
                ))}
                {!data.recentProblems.length && <EmptyState title="还没有公开的题目" />}
              </ul>
            </Section>
          )}

          {has('recent_contests') && (
            <Section
              title="近期比赛"
              action={
                <Link to="/contests" className="text-xs text-primary hover:underline">
                  查看全部 →
                </Link>
              }
            >
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.recentContests.map((contest) => (
                  <li key={contest.id} className="flex items-center gap-3 px-4 py-3">
                    <span
                      className={classNames(
                        'rounded px-1.5 py-0.5 text-xs font-medium',
                        contest.status === 'running'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                          : contest.status === 'upcoming'
                            ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
                            : 'bg-slate-100 text-slate-500 dark:bg-slate-800',
                      )}
                    >
                      {contest.status === 'running' ? '进行中' : contest.status === 'upcoming' ? '即将开始' : '已结束'}
                    </span>
                    <Link to={`/contest/${contest.id}`} className="flex-1 truncate text-sm hover:text-primary">
                      {contest.title}
                    </Link>
                    <span className="hidden text-xs text-slate-400 sm:block">
                      {contest.rules.toUpperCase()} · {formatDuration(contest.start_time, contest.end_time)}
                    </span>
                    <span className="text-xs text-slate-400">
                      {contest.status === 'upcoming' ? countdown(contest.start_time) : formatTime(contest.start_time, false)}
                    </span>
                  </li>
                ))}
                {!data.recentContests.length && <EmptyState title="暂无比赛" />}
              </ul>
            </Section>
          )}

          {has('recent_discussions') && (
            <Section
              title="最新讨论"
              action={
                <Link to="/discussions" className="text-xs text-primary hover:underline">
                  进入讨论区 →
                </Link>
              }
            >
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.recentDiscussions.map((discussion) => (
                  <li key={discussion.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Avatar user={{ username: discussion.username, display_name: discussion.display_name, avatar: discussion.avatar }} size={26} />
                    <Link to={`/discussion/${discussion.id}`} className="flex-1 truncate text-sm hover:text-primary">
                      {discussion.title}
                    </Link>
                    <span className="text-xs text-slate-400">{discussion.reply_count} 回复</span>
                    <span className="hidden text-xs text-slate-400 sm:block">{fromNow(discussion.created_at)}</span>
                  </li>
                ))}
                {!data.recentDiscussions.length && <EmptyState title="还没有人发帖" />}
              </ul>
            </Section>
          )}
        </div>

        <div className="space-y-5">
          {!user && (
            <div className="card p-4">
              <h2 className="text-sm font-semibold">欢迎来到 {String(settings.site_name ?? 'OGOJ')}</h2>
              <p className="mt-1 text-xs text-slate-500">
                注册后即可提交代码、参加比赛、发布题解。通过题目还能获得积分兑换商店特权。
              </p>
              <div className="mt-3 flex gap-2">
                <Link to="/register" className="btn-primary flex-1">
                  立即注册
                </Link>
                <Link to="/login" className="btn-ghost flex-1">
                  登录
                </Link>
              </div>
            </div>
          )}

          {data.announcements.length > 0 && (
            <Section title="站内公告">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.announcements.map((announcement) => (
                  <li key={announcement.id} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {announcement.is_pinned ? <span className="text-xs text-rose-500">[置顶]</span> : null}
                      <Link to={`/about#announcement-${announcement.id}`} className="text-sm hover:text-primary">
                        {announcement.title}
                      </Link>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                      {announcement.content.slice(0, 80)}
                    </p>
                    <span className="mt-1 block text-[11px] text-slate-400">{fromNow(announcement.created_at)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {has('ranklist') && (
            <Section
              title="活跃排行"
              action={
                <Link to="/rank" className="text-xs text-primary hover:underline">
                  完整榜单 →
                </Link>
              }
            >
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.ranklist.map((entry, index) => (
                  <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      className={classNames(
                        'w-5 text-center text-xs font-semibold',
                        index < 3 ? 'text-amber-500' : 'text-slate-400',
                      )}
                    >
                      {index + 1}
                    </span>
                    <UserLink user={entry} size={24} />
                    <span className="ml-auto text-xs text-slate-500">{entry.solved_count} 题</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {has('tags') && data.tags.length > 0 && (
            <Section title="热门标签">
              <div className="flex flex-wrap gap-1.5 p-4">
                {data.tags.map((tag) => (
                  <Link key={tag.id} to={`/problems?tag=${tag.id}`} className="transition hover:opacity-80">
                    <span
                      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs"
                      style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                    >
                      {tag.name}
                      <span className="opacity-60">{tag.use_count}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
