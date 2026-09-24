import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Activity, CalendarClock, Trophy, Users2 } from 'lucide-react';
import { api } from '../../lib/api';
import { classNames, formatTime, fromNow } from '../../lib/format';
import { DifficultyBadge, EmptyState, Section, UserLink } from '../../components/ui';
import type { TeamContextValue } from './TeamLayout';

export default function TeamOverview() {
  const { team, stats, permissions, membership } = useOutletContext<TeamContextValue>();
  const [data, setData] = useState<any>(null);
  const [statistics, setStatistics] = useState<any>(null);

  useEffect(() => {
    api.get<any>(`/api/teams/${team.slug}`).then(setData).catch(() => undefined);
    api.get<any>(`/api/teams/${team.slug}/statistics`).then(setStatistics).catch(() => undefined);
  }, [team.slug]);

  const cards = [
    { label: '成员', value: stats.members, to: `/team/${team.slug}/members`, icon: Users2 },
    { label: '题目', value: stats.problems, to: `/team/${team.slug}/problems`, icon: Activity },
    { label: '作业', value: stats.assignments, to: `/team/${team.slug}/assignments`, icon: CalendarClock },
    { label: '比赛', value: stats.contests, to: `/team/${team.slug}/contests`, icon: Trophy },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Link key={card.label} to={card.to} className="card flex items-center gap-3 p-4 hover:shadow-md">
            <span className="rounded-lg bg-primary/10 p-2 text-primary">
              <card.icon className="h-4 w-4" />
            </span>
            <div>
              <div className="text-lg font-semibold">{card.value}</div>
              <div className="text-xs text-slate-500">{card.label}</div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="团队题目"
          action={
            <Link to={`/team/${team.slug}/problems`} className="text-xs text-primary hover:underline">
              全部题目 →
            </Link>
          }
        >
          {!data?.recentProblems?.length ? (
            <EmptyState title="团队还没有添加题目" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.recentProblems.map((problem: any) => (
                <li key={problem.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-16 font-mono text-xs text-slate-400">{problem.pid}</span>
                  <Link to={`/problem/${problem.pid}`} className="flex-1 truncate text-sm hover:text-primary">
                    {problem.title}
                  </Link>
                  <DifficultyBadge value={problem.difficulty} compact />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="近期讨论"
          action={
            <Link to={`/team/${team.slug}/discussions`} className="text-xs text-primary hover:underline">
              进入讨论区 →
            </Link>
          }
        >
          {!data?.recentDiscussions?.length ? (
            <EmptyState title="还没有讨论" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.recentDiscussions.map((discussion: any) => (
                <li key={discussion.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Link
                    to={`/team/${team.slug}/discussions/${discussion.id}`}
                    className="flex-1 truncate hover:text-primary"
                  >
                    {discussion.title}
                  </Link>
                  <span className="text-xs text-slate-400">{discussion.reply_count} 回复</span>
                  <span className="hidden text-xs text-slate-400 sm:block">{fromNow(discussion.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="作业安排"
          action={
            <Link to={`/team/${team.slug}/assignments`} className="text-xs text-primary hover:underline">
              全部作业 →
            </Link>
          }
        >
          {!data?.upcomingAssignments?.length ? (
            <EmptyState title="暂无作业" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.upcomingAssignments.map((assignment: any) => (
                <li key={assignment.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Link
                    to={`/team/${team.slug}/assignments/${assignment.id}`}
                    className="flex-1 truncate hover:text-primary"
                  >
                    {assignment.title}
                  </Link>
                  <span className="text-xs text-slate-400">
                    {assignment.end_time ? `截止 ${formatTime(assignment.end_time, false)}` : '长期有效'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="成员贡献榜">
          {!data?.topMembers?.length ? (
            <EmptyState title="暂无成员" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.topMembers.map((member: any, index: number) => (
                <li key={member.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className={classNames('w-5 text-center text-xs font-semibold', index < 3 ? 'text-amber-500' : 'text-slate-400')}>
                    {index + 1}
                  </span>
                  <UserLink user={member} size={24} />
                  {member.role === 'owner' && <span className="text-xs text-rose-500">团长</span>}
                  {member.role === 'admin' && <span className="text-xs text-amber-500">管理员</span>}
                  <span className="ml-auto text-xs text-slate-500">贡献 {member.contribution}</span>
                  <span className="text-xs text-slate-400">通过 {member.solved_count} 题</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {statistics && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="题目难度分布">
            {!statistics.difficultyDistribution?.length ? (
              <EmptyState title="暂无数据" />
            ) : (
              <ul className="space-y-2 p-4 text-sm">
                {statistics.difficultyDistribution.map((row: any) => (
                  <li key={row.difficulty} className="flex items-center gap-3">
                    <DifficultyBadge value={row.difficulty} compact />
                    <span className="text-slate-500">{row.c} 道</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="团队动态">
            {!statistics.recentActivity?.length ? (
              <EmptyState title="暂无动态" />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {statistics.recentActivity.map((activity: any) => (
                  <li key={activity.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Link to={`/record/${activity.id}`} className="font-mono text-xs text-slate-400">
                      #{activity.id}
                    </Link>
                    <span className="truncate">
                      {activity.display_name || activity.username} 提交了 {activity.pid}
                    </span>
                    <span
                      className={classNames(
                        'ml-auto text-xs',
                        activity.status === 'AC' ? 'text-emerald-600' : 'text-slate-400',
                      )}
                    >
                      {activity.status}
                    </span>
                    <span className="hidden text-xs text-slate-400 sm:block">{fromNow(activity.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}

      {permissions.settings && membership && (
        <p className="text-center text-xs text-slate-400">
          你是该团队的管理者，可以在「团队设置」中修改资料、公告、组别与黑名单。
        </p>
      )}
    </div>
  );
}
