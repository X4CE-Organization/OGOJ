import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Award, Calendar, Camera, MapPin, MessageSquarePlus, UserMinus, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, DIFFICULTY_COLORS, DIFFICULTY_COLORS_DARK, DIFFICULTY_NAMES, formatMemory, formatMs, formatTime, fromNow } from '../lib/format';
import { Avatar, DifficultyBadge, EmptyState, Loading, Modal, StatusText, Tabs, TagBadge } from '../components/ui';
import BackButton from '../components/BackButton';
import ImageUploadField from '../components/ImageUploadField';
import { useToast } from '../components/Toast';

export default function UserProfile() {
  const { username = '' } = useParams();
  const { user: viewer, settings, refresh } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('solved');
  const [solutions, setSolutions] = useState<any[]>([]);
  const [articles, setArticles] = useState<any[]>([]);
  const [discussions, setDiscussions] = useState<any[]>([]);
  const [badges, setBadges] = useState<{ unlocked: any[]; total: number } | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarDraft, setAvatarDraft] = useState('');
  const [bannerDraft, setBannerDraft] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api.get<any>(`/api/users/${encodeURIComponent(username)}`);
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab === 'solutions') {
      api.get<any>(`/api/users/${username}/solutions`).then((r) => setSolutions(r.items)).catch(() => undefined);
    }
    if (tab === 'articles') {
      api.get<any>(`/api/users/${username}/articles`).then((r) => setArticles(r.items)).catch(() => undefined);
    }
    if (tab === 'discussions') {
      api.get<any>(`/api/users/${username}/discussions`).then((r) => setDiscussions(r.items)).catch(() => undefined);
    }
  }, [tab, username]);

  useEffect(() => {
    api
      .get<{ unlocked: any[]; total: number }>(`/api/users/${encodeURIComponent(username)}/achievements`)
      .then(setBadges)
      .catch(() => undefined);
  }, [username]);

  const toggleFollow = async () => {
    try {
      const result = await api.post<{ following: boolean }>(`/api/users/${encodeURIComponent(username)}/follow`);
      setData({
        ...data,
        profile: {
          ...data.profile,
          isFollowing: result.following,
          followers: data.profile.followers + (result.following ? 1 : -1),
        },
      });
    } catch {
      /* ignore */
    }
  };

  if (loading) return <Loading />;
  if (!data) return <EmptyState title="用户不存在" />;

  const profile = data.profile;
  const maxDifficulty = Math.max(1, ...profile.solvedByDifficulty.map((item: any) => item.c));

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <div className="lg:col-span-2">
        <BackButton label="返回上一页" fallback="/rank" useHistory />
      </div>
      <aside className="space-y-4">
        <div className="card overflow-hidden">
          {profile.banner ? (
            <img src={profile.banner} alt="" className="h-24 w-full object-cover" />
          ) : (
            <div className="h-24 bg-gradient-to-r from-sky-400 via-cyan-400 to-indigo-400" />
          )}
          <div className="-mt-10 px-4 pb-4">
            <Avatar user={profile} size={72} className="ring-4 ring-white dark:ring-slate-900" />
            <h1 className="mt-2 text-lg font-bold">
              {profile.display_name || profile.username}
              {(profile.isSelf || viewer?.role === 'admin' || viewer?.role === 'superadmin') &&
                profile.role === 'superadmin' && <span className="ml-1 text-xs text-rose-500">超级管理员</span>}
              {(profile.isSelf || viewer?.role === 'admin' || viewer?.role === 'superadmin') &&
                profile.role === 'admin' && <span className="ml-1 text-xs text-amber-500">管理员</span>}
            </h1>
            <p className="text-xs text-slate-400">
              @{profile.username} · UID {profile.id}
            </p>
            <p className="mt-1 text-xs text-slate-500">{profile.level?.name}</p>
            {profile.bio && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{profile.bio}</p>}
            <div className="mt-2 space-y-1 text-xs text-slate-500">
              {profile.school && (
                <div className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {profile.school}
                </div>
              )}
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3" /> 加入于 {formatTime(profile.createdAt, false)}
              </div>
              {profile.ccfLevel && (
                <div className="flex items-center gap-1">
                  <Award className="h-3 w-3" /> {profile.ccfLevel}
                </div>
              )}
            </div>

            {viewer && !profile.isSelf && (
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  className={classNames('w-full', profile.isFollowing ? 'btn-ghost' : 'btn-primary')}
                  onClick={toggleFollow}
                >
                  {profile.isFollowing ? (
                    <>
                      <UserMinus className="h-4 w-4" /> 取消关注
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" /> 关注
                    </>
                  )}
                </button>
                {settings.enable_private_message !== false && (
                  <Link to={`/messages?to=${encodeURIComponent(profile.username)}`} className="btn-ghost w-full">
                    <MessageSquarePlus className="h-4 w-4" /> 发私信
                  </Link>
                )}
              </div>
            )}
            {profile.isSelf && (
              <div className="mt-3 space-y-2">
                <Link to="/settings" className="btn-ghost w-full">
                  编辑资料
                </Link>
                <button
                  type="button"
                  className="btn-primary w-full"
                  onClick={() => {
                    setAvatarDraft(profile.avatar ?? '');
                    setBannerDraft(profile.banner ?? '');
                    setAvatarOpen(true);
                  }}
                >
                  <Camera className="h-4 w-4" /> 更换头像 / 背景
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">统计</h2>
          <dl className="grid grid-cols-2 gap-3 text-center">
            {[
              ['通过题目', profile.solvedCount ?? profile.solved_count ?? 0],
              ['提交次数', profile.totalSubmissions],
              ['通过率', `${profile.acceptanceRate}%`],
              ['排名', `#${profile.rank}`],
              ['粉丝', profile.followers],
              ['关注', profile.following],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg bg-slate-50 py-2 dark:bg-slate-800">
                <dt className="text-xs text-slate-400">{label}</dt>
                <dd className="mt-0.5 font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          {settings.enable_points !== false && (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2 text-sm">
              <span className="text-primary">积分</span>
              <span className="font-semibold text-primary">{profile.points}</span>
            </div>
          )}
          {settings.show_rating !== false && (
            <div className="mt-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2 text-sm">
              <span className="text-amber-600 dark:text-amber-400">等级分</span>
              <span className="font-semibold text-amber-600 dark:text-amber-400">{profile.rating}</span>
            </div>
          )}
        </div>

        {profile.canSeeRecords && profile.solvedByDifficulty.length > 0 && (
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold">难度分布</h2>
            <div className="space-y-1.5">
              {DIFFICULTY_NAMES.map((name, index) => {
                const count =
                  profile.solvedByDifficulty.find((item: any) => item.difficulty === index + 1)?.c ?? 0;
                return (
                  <div key={name} className="flex items-center gap-2 text-xs">
                    <span className="w-24 shrink-0 truncate text-slate-500">{name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full [background-color:var(--bar)] dark:[background-color:var(--bar-dark)]"
                        style={{
                          width: `${(count / maxDifficulty) * 100}%`,
                          ['--bar' as string]: DIFFICULTY_COLORS[index],
                          ['--bar-dark' as string]: DIFFICULTY_COLORS_DARK[index],
                        }}
                      />
                    </div>
                    <span className="w-6 text-right text-slate-500">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {badges && badges.unlocked.length > 0 && (
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">成就徽章</h2>
              <Link to="/achievements" className="text-xs text-primary hover:underline">
                {badges.unlocked.length} / {badges.total} →
              </Link>
            </div>
            <div className="flex flex-wrap gap-2">
              {badges.unlocked.slice(0, 12).map((badge) => (
                <span
                  key={badge.id}
                  title={`${badge.name}：${badge.description}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-50 text-lg ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
                >
                  {badge.icon}
                </span>
              ))}
            </div>
          </div>
        )}
      </aside>

      <Modal
        open={avatarOpen}
        title="更换头像与主页背景"
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
                  await api.put('/api/auth/profile', { avatar: avatarDraft, banner: bannerDraft });
                  setAvatarOpen(false);
                  await refresh();
                  void load();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : '保存失败');
                }
              }}
            >
              保存
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <ImageUploadField
            value={avatarDraft}
            onChange={setAvatarDraft}
            category="avatar"
            previewClassName="h-20 w-20"
            rounded="rounded-full"
            hint="支持 jpg / png / gif / webp，建议使用正方形图片（至少 200×200）"
          />
          <ImageUploadField
            value={bannerDraft}
            onChange={setBannerDraft}
            category="banner"
            previewClassName="h-20 w-40"
            hint="个人主页顶部横幅，建议 1200×300"
          />
        </div>
      </Modal>

      <div className="space-y-4">
        <div className="card overflow-hidden">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: 'solved', label: '通过题目', badge: data.solvedProblems.length || undefined },
              { key: 'submissions', label: '提交记录' },
              { key: 'contests', label: '比赛记录' },
              { key: 'solutions', label: '题解' },
              { key: 'articles', label: '文章广场' },
              { key: 'discussions', label: '讨论' },
            ]}
          />
          <div className="p-4">
            {!profile.canSeeRecords && tab !== 'solutions' && tab !== 'articles' && tab !== 'discussions' ? (
              <EmptyState title="该用户隐藏了提交记录与通过题目" />
            ) : tab === 'solved' ? (
              data.solvedProblems.length === 0 ? (
                <EmptyState title="还没有通过的题目" />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.solvedProblems.map((problem: any) => (
                    <li key={problem.id} className="flex items-center gap-3 py-2.5">
                      <span className="w-16 font-mono text-xs text-slate-400">{problem.pid}</span>
                      <Link to={`/problem/${problem.pid}`} className="flex-1 truncate text-sm hover:text-primary">
                        {problem.title}
                      </Link>
                      <div className="hidden gap-1 sm:flex">
                        {problem.tags.slice(0, 2).map((tag: any) => (
                          <TagBadge key={tag.id} tag={tag} />
                        ))}
                      </div>
                      <DifficultyBadge value={problem.difficulty} compact />
                      <span className="hidden text-xs text-slate-400 sm:block">{fromNow(problem.firstAcAt)}</span>
                    </li>
                  ))}
                </ul>
              )
            ) : tab === 'submissions' ? (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th className="w-20">编号</th>
                      <th>题目</th>
                      <th className="w-36">结果</th>
                      <th className="w-24">时间</th>
                      <th className="w-24">内存</th>
                      <th className="w-32">提交时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentSubmissions.map((item: any) => (
                      <tr key={item.id}>
                        <td>
                          <Link to={`/record/${item.id}`} className="link font-mono text-xs">
                            #{item.id}
                          </Link>
                        </td>
                        <td>
                          <Link to={`/problem/${item.problemPid}`} className="hover:text-primary">
                            {item.problemTitle}
                          </Link>
                        </td>
                        <td>
                          <StatusText status={item.status} score={item.score} />
                        </td>
                        <td className="text-xs text-slate-500">{formatMs(item.timeMs)}</td>
                        <td className="text-xs text-slate-500">{formatMemory(item.memoryKb)}</td>
                        <td className="text-xs text-slate-400">{fromNow(item.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.recentSubmissions.length === 0 && <EmptyState title="暂无提交记录" />}
              </div>
            ) : tab === 'contests' ? (
              data.contestHistory.length === 0 ? (
                <EmptyState title="还没有参加过比赛" />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.contestHistory.map((contest: any) => (
                    <li key={contest.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <Link to={`/contest/${contest.id}`} className="flex-1 hover:text-primary">
                        {contest.title}
                      </Link>
                      <span className="text-xs text-slate-400">{contest.rules.toUpperCase()}</span>
                      <span className="text-xs text-slate-400">{formatTime(contest.start_time, false)}</span>
                    </li>
                  ))}
                </ul>
              )
            ) : tab === 'solutions' ? (
              solutions.length === 0 ? (
                <EmptyState title="还没有发布题解" />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {solutions.map((solution) => (
                    <li key={solution.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <Link to={`/solution/${solution.id}`} className="flex-1 hover:text-primary">
                        {solution.title}
                      </Link>
                      <span className="text-xs text-slate-400">{solution.pid}</span>
                      <span className="text-xs text-slate-400">👍 {solution.upvotes}</span>
                    </li>
                  ))}
                </ul>
              )
            ) : tab === 'articles' ? (
              articles.length === 0 ? (
                <EmptyState title="还没有发布文章" />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {articles.map((article) => (
                    <li key={article.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <Link to={`/article/${article.id}`} className="flex-1 hover:text-primary">
                        {article.title}
                      </Link>
                      <span className="text-xs text-slate-400">{fromNow(article.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )
            ) : discussions.length === 0 ? (
              <EmptyState title="还没有发过帖" />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {discussions.map((discussion) => (
                  <li key={discussion.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <Link to={`/discussion/${discussion.id}`} className="flex-1 hover:text-primary">
                      {discussion.title}
                    </Link>
                    <span className="text-xs text-slate-400">{discussion.reply_count} 回复</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
