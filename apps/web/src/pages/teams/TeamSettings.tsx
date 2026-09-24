import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { classNames, fromNow } from '../../lib/format';
import { TEAM_POLICIES } from '../../lib/team';
import TeamPolicyBadge from '../../components/TeamPolicyBadge';
import { EmptyState, Field, Loading, Modal, Section, UserLink } from '../../components/ui';
import ImageUploadField from '../../components/ImageUploadField';
import { useToast } from '../../components/Toast';
import type { TeamContextValue } from './TeamLayout';

const PERMISSIONS: { key: string; label: string }[] = [
  { key: 'members', label: '成员管理' },
  { key: 'applications', label: '审核加入申请' },
  { key: 'problems', label: '题目管理' },
  { key: 'assignments', label: '作业管理' },
  { key: 'contests', label: '比赛管理' },
  { key: 'lists', label: '题单管理' },
  { key: 'files', label: '文件管理' },
  { key: 'discussions', label: '讨论区管理' },
  { key: 'settings', label: '团队设置' },
];

export default function TeamSettings() {
  const ctx = useOutletContext<TeamContextValue>();
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'profile' | 'groups' | 'blacklist'>('profile');
  const [form, setForm] = useState({
    name: '',
    description: '',
    announcement: '',
    avatar: '',
    background: '',
    category: '',
    joinPolicy: 'open',
    maxMembers: 0,
    allowMemberInvite: true,
    isPublic: true,
  });
  const [groups, setGroups] = useState<any[]>([]);
  const [blacklist, setBlacklist] = useState<any[]>([]);
  const [groupModal, setGroupModal] = useState<any>(null);
  const [applications, setApplications] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const team = await api.get<any>(`/api/teams/${ctx.team.slug}`);
      setForm({
        name: team.team.name,
        description: team.team.description ?? '',
        announcement: team.team.announcement ?? '',
        avatar: team.team.avatar ?? '',
        background: team.team.background ?? '',
        category: team.team.category ?? '',
        joinPolicy: team.team.joinPolicy ?? 'open',
        maxMembers: team.team.maxMembers ?? 0,
        allowMemberInvite: true,
        isPublic: team.team.isPublic,
      });
      setGroups((await api.get<any>(`/api/teams/${ctx.team.slug}/groups`)).items ?? []);
      setBlacklist((await api.get<any>(`/api/teams/${ctx.team.slug}/blacklist`)).items ?? []);
      if (ctx.permissions.applications) {
        setApplications((await api.get<any>(`/api/teams/${ctx.team.slug}/applications?status=pending`)).items ?? []);
      }
    } catch {
      /* 忽略 */
    } finally {
      setLoading(false);
    }
  }, [ctx.team.slug, ctx.permissions.applications]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    try {
      await api.put(`/api/teams/${ctx.team.slug}`, form);
      toast.success('团队设置已保存');
      void ctx.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const saveGroup = async () => {
    try {
      if (groupModal.id) {
        await api.put(`/api/teams/${ctx.team.slug}/groups/${groupModal.id}`, groupModal);
      } else {
        await api.post(`/api/teams/${ctx.team.slug}/groups`, groupModal);
      }
      toast.success('组别已保存');
      setGroupModal(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const removeGroup = async (group: any) => {
    if (!window.confirm(`确定删除组别「${group.name}」吗？组内成员会变成未分组。`)) return;
    await api.del(`/api/teams/${ctx.team.slug}/groups/${group.id}`);
    toast.success('已删除');
    void load();
  };

  const disband = async () => {
    if (!window.confirm('确定解散团队吗？此操作会隐藏团队并从列表移除。')) return;
    try {
      await api.del(`/api/teams/${ctx.team.slug}`);
      toast.success('团队已解散');
      navigate('/teams');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '解散失败');
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="card flex items-center gap-1 p-2">
        {[
          { key: 'profile', label: '基本资料' },
          { key: 'groups', label: `组别（${groups.length}）` },
          { key: 'blacklist', label: `黑名单（${blacklist.length}）` },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key as any)}
            className={classNames(
              'rounded-lg px-3 py-1.5 text-sm',
              tab === item.key ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
            )}
          >
            {item.label}
          </button>
        ))}
        {applications.length > 0 && (
          <span className="ml-auto text-xs text-amber-600">有 {applications.length} 条加入申请待处理（见「成员」页）</span>
        )}
      </div>

      {tab === 'profile' && (
        <Section title="团队资料">
          <div className="space-y-4 p-4">
            <Field label="团队名称" required>
              <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <Field label="团队介绍" hint="未加入的用户也能看到">
              <textarea
                className="input min-h-[100px]"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </Field>
            <Field label="团队公告" hint="只有团队成员能看到，会显示在团队首页">
              <textarea
                className="input min-h-[100px]"
                value={form.announcement}
                onChange={(event) => setForm({ ...form, announcement: event.target.value })}
                placeholder="例如：本周训练安排、比赛提醒…"
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="团队头像">
                <ImageUploadField
                  value={form.avatar}
                  onChange={(next) => setForm({ ...form, avatar: next })}
                  category="teams"
                  previewClassName="h-16 w-16"
                  rounded="rounded-xl"
                />
              </Field>
              <Field label="团队主页背景">
                <ImageUploadField
                  value={form.background}
                  onChange={(next) => setForm({ ...form, background: next })}
                  category="teams"
                  previewClassName="h-16 w-32"
                />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="公开程度" hint="公开团队任何人可直接加入；保护团队需要审核；私有团队凭邀请码">
                <div className="space-y-2">
                  {TEAM_POLICIES.map((item, index) => {
                    const value = ['open', 'approval', 'closed'][index]!;
                    return (
                      <label
                        key={value}
                        className={classNames(
                          'flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm',
                          form.joinPolicy === value
                            ? 'border-primary bg-primary/5'
                            : 'border-slate-200 dark:border-slate-700',
                        )}
                      >
                        <input
                          type="radio"
                          className="mt-0.5"
                          checked={form.joinPolicy === value}
                          onChange={() => setForm({ ...form, joinPolicy: value })}
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <TeamPolicyBadge policy={value} full />
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-400">{item.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </Field>
              <Field label="团队分类">
                <input
                  className="input"
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                />
              </Field>
              <Field label="成员上限" hint="0 表示不限">
                <input
                  className="input"
                  type="number"
                  value={form.maxMembers}
                  onChange={(event) => setForm({ ...form, maxMembers: Number(event.target.value) })}
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-300">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={form.isPublic}
                  onChange={(event) => setForm({ ...form, isPublic: event.target.checked })}
                />
                公开团队主页
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={form.allowMemberInvite}
                  onChange={(event) => setForm({ ...form, allowMemberInvite: event.target.checked })}
                />
                允许成员邀请
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
              <div className="text-xs text-slate-400">
                邀请码：<code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{ctx.team.inviteCode ?? '—'}</code>
                <button
                  type="button"
                  className="ml-2 text-primary hover:underline"
                  onClick={async () => {
                    await api.put(`/api/teams/${ctx.team.slug}`, { resetInviteCode: true });
                    toast.success('邀请码已重置');
                    void ctx.reload();
                    void load();
                  }}
                >
                  重置
                </button>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-danger !py-1.5 text-xs" onClick={disband}>
                  解散团队
                </button>
                <button type="button" className="btn-primary" onClick={save}>
                  保存设置
                </button>
              </div>
            </div>
          </div>
        </Section>
      )}

      {tab === 'groups' && (
        <Section
          title="组别与权限"
          action={
            <button
              type="button"
              className="btn-primary !px-2.5 !py-1 text-xs"
              onClick={() =>
                setGroupModal({
                  name: '',
                  color: '#60a5fa',
                  description: '',
                  permissions: {},
                  isDefault: false,
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> 新建组别
            </button>
          }
        >
          {!groups.length ? (
            <EmptyState title="还没有组别" description="用组别区分成员的职责，并逐项分配管理权限" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {groups.map((group) => (
                <li key={group.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span
                    className="rounded px-2 py-0.5 text-sm font-medium"
                    style={{ backgroundColor: `${group.color}22`, color: group.color }}
                  >
                    {group.name}
                  </span>
                  {group.is_default ? (
                    <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-500 dark:bg-slate-800">默认组别</span>
                  ) : null}
                  <span className="text-xs text-slate-400">{group.member_count} 人</span>
                  <span className="flex-1 truncate text-xs text-slate-400">{group.description}</span>
                  <span className="flex flex-wrap gap-1">
                    {PERMISSIONS.filter((permission) => group[`can_manage_${permission.key}`]).map((permission) => (
                      <span key={permission.key} className="rounded bg-primary/10 px-1.5 text-[11px] text-primary">
                        {permission.label}
                      </span>
                    ))}
                  </span>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() =>
                        setGroupModal({
                          id: group.id,
                          name: group.name,
                          color: group.color,
                          description: group.description,
                          isDefault: Boolean(group.is_default),
                          permissions: Object.fromEntries(
                            PERMISSIONS.map((permission) => [permission.key, Boolean(group[`can_manage_${permission.key}`])]),
                          ),
                        })
                      }
                    >
                      编辑
                    </button>
                    {!group.is_default && (
                      <button type="button" className="text-rose-500 hover:underline" onClick={() => removeGroup(group)}>
                        <Trash2 className="inline h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {tab === 'blacklist' && (
        <Section title={`黑名单（${blacklist.length}）`}>
          {!blacklist.length ? (
            <EmptyState title="黑名单为空" description="被拉黑的用户无法申请或加入团队，可在「成员」页面添加" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {blacklist.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <UserLink user={entry} size={22} />
                  <span className="text-xs text-slate-400">{entry.reason || '未填写原因'}</span>
                  <span className="ml-auto text-xs text-slate-400">{fromNow(entry.created_at)}</span>
                  <button
                    type="button"
                    className="text-xs text-emerald-600 hover:underline"
                    onClick={async () => {
                      await api.del(`/api/teams/${ctx.team.slug}/blacklist/${entry.id}`);
                      toast.success('已解除');
                      void load();
                    }}
                  >
                    解除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Modal
        open={Boolean(groupModal)}
        title={groupModal?.id ? '编辑组别' : '新建组别'}
        onClose={() => setGroupModal(null)}
        width="max-w-xl"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setGroupModal(null)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={saveGroup}>
              保存
            </button>
          </>
        }
      >
        {groupModal && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="组别名称" required>
                <input
                  className="input"
                  value={groupModal.name}
                  onChange={(event) => setGroupModal({ ...groupModal, name: event.target.value })}
                />
              </Field>
              <Field label="颜色">
                <input
                  className="input"
                  type="color"
                  value={groupModal.color}
                  onChange={(event) => setGroupModal({ ...groupModal, color: event.target.value })}
                />
              </Field>
            </div>
            <Field label="组别说明">
              <input
                className="input"
                value={groupModal.description}
                onChange={(event) => setGroupModal({ ...groupModal, description: event.target.value })}
              />
            </Field>
            <div>
              <span className="label">管理权限</span>
              <div className="grid gap-2 sm:grid-cols-3">
                {PERMISSIONS.map((permission) => (
                  <label key={permission.key} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={Boolean(groupModal.permissions?.[permission.key])}
                      onChange={(event) =>
                        setGroupModal({
                          ...groupModal,
                          permissions: { ...groupModal.permissions, [permission.key]: event.target.checked },
                        })
                      }
                    />
                    {permission.label}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-500">
              <input
                type="checkbox"
                checked={Boolean(groupModal.isDefault)}
                onChange={(event) => setGroupModal({ ...groupModal, isDefault: event.target.checked })}
              />
              设为新成员的默认组别
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
