import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Ban, Check, Crown, Search, UserMinus, X } from 'lucide-react';
import { api, query } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { classNames, fromNow } from '../../lib/format';
import { Avatar, EmptyState, Field, Loading, Modal, Section, UserLink } from '../../components/ui';
import { useToast } from '../../components/Toast';
import type { TeamContextValue } from './TeamLayout';

export default function TeamMembers() {
  const ctx = useOutletContext<TeamContextValue>();
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [applications, setApplications] = useState<any[]>([]);
  const [blacklist, setBlacklist] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState({ role: 'member', groupId: '', nickname: '' });
  const [banUser, setBanUser] = useState('');
  const [banReason, setBanReason] = useState('');
  const [banOpen, setBanOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<any>(`/api/teams/${ctx.team.slug}/members${query({ q: keyword, group: groupFilter })}`));
      if (ctx.permissions.members) {
        setBlacklist((await api.get<any>(`/api/teams/${ctx.team.slug}/blacklist`)).items ?? []);
      }
      if (ctx.permissions.applications) {
        setApplications(
          (await api.get<any>(`/api/teams/${ctx.team.slug}/applications${query({ status: 'pending' })}`)).items ?? [],
        );
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ctx.team.slug, ctx.permissions.members, ctx.permissions.applications, keyword, groupFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (application: any, approve: boolean) => {
    try {
      await api.post(`/api/teams/${ctx.team.slug}/applications/${application.id}`, {
        approve,
        note: approve ? '' : String(window.prompt('拒绝理由', '暂时不符合团队要求') ?? ''),
      });
      toast.success(approve ? '已通过申请' : '已拒绝申请');
      void load();
      void ctx.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const saveMember = async () => {
    if (!editing) return;
    try {
      await api.put(`/api/teams/${ctx.team.slug}/members/${editing.id}`, {
        role: editForm.role,
        groupId: editForm.groupId ? Number(editForm.groupId) : 0,
        nickname: editForm.nickname,
      });
      toast.success('已更新成员信息');
      setEditing(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const removeMember = async (member: any) => {
    const blacklistIt = window.confirm(`确定把 ${member.username} 移出团队吗？\n点「确定」同时加入黑名单，点「取消」仅移出。`);
    try {
      await api.del(
        `/api/teams/${ctx.team.slug}/members/${member.id}${query({ blacklist: blacklistIt ? 'true' : '', reason: '被移出团队' })}`,
      );
      toast.success('已移出团队');
      void load();
      void ctx.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const transfer = async (member: any) => {
    if (!window.confirm(`确定把团长转让给 ${member.username} 吗？转让后你将成为管理员。`)) return;
    try {
      await api.post(`/api/teams/${ctx.team.slug}/transfer`, { userId: member.id });
      toast.success('已转让团队');
      void load();
      void ctx.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '转让失败');
    }
  };

  const addBlacklist = async () => {
    try {
      await api.post(`/api/teams/${ctx.team.slug}/blacklist`, { username: banUser, reason: banReason });
      toast.success('已加入黑名单');
      setBanOpen(false);
      setBanUser('');
      setBanReason('');
      void load();
      void ctx.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const removeBlacklist = async (entry: any) => {
    await api.del(`/api/teams/${ctx.team.slug}/blacklist/${entry.id}`);
    toast.success('已移出黑名单');
    void load();
  };

  const canManage = data?.canManage ?? false;
  const isOwner = ctx.membership?.role === 'owner';

  return (
    <div className="space-y-4">
      {ctx.permissions.applications && applications.length > 0 && (
        <Section title={`加入申请（${applications.length} 条待处理）`}>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {applications.map((application) => (
              <li key={application.id} className="flex items-start gap-3 px-4 py-3">
                <Avatar user={application} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <UserLink user={application} />
                    <span className="text-xs text-slate-400">
                      通过 {application.solved_count} 题 · 申请于 {fromNow(application.created_at)}
                    </span>
                  </div>
                  {application.message && (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{application.message}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2 text-xs">
                  <button type="button" className="text-emerald-600 hover:underline" onClick={() => review(application, true)}>
                    <Check className="mr-0.5 inline h-3.5 w-3.5" /> 通过
                  </button>
                  <button type="button" className="text-rose-500 hover:underline" onClick={() => review(application, false)}>
                    <X className="mr-0.5 inline h-3.5 w-3.5" /> 拒绝
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            className="input !w-56 !pl-8"
            placeholder="搜索成员"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <select className="input !w-40" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
          <option value="">全部组别</option>
          {(data?.groups ?? []).map((group: any) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
        {canManage && (
          <button type="button" className="btn-ghost ml-auto !py-1.5 text-xs" onClick={() => setBanOpen(true)}>
            <Ban className="h-3.5 w-3.5" /> 拉黑用户
          </button>
        )}
        <span className={classNames('text-xs text-slate-400', !canManage && 'ml-auto')}>
          共 {data?.items?.length ?? 0} 位成员
        </span>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="暂无成员" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>成员</th>
                  <th className="w-28">身份</th>
                  <th className="w-32">组别</th>
                  <th className="w-24">贡献度</th>
                  <th className="w-24">通过题目</th>
                  <th className="w-32">加入时间</th>
                  {canManage && <th className="w-48">操作</th>}
                </tr>
              </thead>
              <tbody>
                {data.items.map((member: any) => (
                  <tr key={member.id} className={classNames(member.id === user?.id && 'bg-primary/[0.04]')}>
                    <td>
                      <UserLink user={member} size={26} />
                      {member.nickname && <span className="ml-1 text-xs text-slate-400">（{member.nickname}）</span>}
                    </td>
                    <td className="text-xs">
                      {member.role === 'owner' ? (
                        <span className="inline-flex items-center gap-1 text-rose-500">
                          <Crown className="h-3 w-3" /> 团长
                        </span>
                      ) : member.role === 'admin' ? (
                        <span className="text-amber-500">管理员</span>
                      ) : (
                        <span className="text-slate-500">成员</span>
                      )}
                    </td>
                    <td className="text-xs">
                      {member.group_name ? (
                        <span
                          className="rounded px-1.5 py-0.5"
                          style={{ backgroundColor: `${member.group_color}22`, color: member.group_color }}
                        >
                          {member.group_name}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="text-xs text-slate-500">{member.contribution}</td>
                    <td className="text-xs text-slate-500">{member.solved_count}</td>
                    <td className="text-xs text-slate-400">{fromNow(member.joined_at)}</td>
                    {canManage && (
                      <td>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <button
                            type="button"
                            className="text-primary hover:underline"
                            onClick={() => {
                              setEditing(member);
                              setEditForm({
                                role: member.role,
                                groupId: member.group_id ? String(member.group_id) : '',
                                nickname: member.nickname ?? '',
                              });
                            }}
                          >
                            编辑
                          </button>
                          {isOwner && member.role !== 'owner' && (
                            <button type="button" className="text-amber-600 hover:underline" onClick={() => transfer(member)}>
                              转让团长
                            </button>
                          )}
                          {member.role !== 'owner' && (
                            <button type="button" className="text-rose-500 hover:underline" onClick={() => removeMember(member)}>
                              <UserMinus className="mr-0.5 inline h-3.5 w-3.5" /> 移出
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canManage && (
        <Section title={`黑名单（${blacklist.length}）`}>
          {!blacklist.length ? (
            <EmptyState title="黑名单为空" description="被拉黑的用户无法申请或加入团队" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {blacklist.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Avatar user={entry} size={24} />
                  <UserLink user={entry} showAvatar={false} />
                  <span className="text-xs text-slate-400">{entry.reason || '未填写原因'}</span>
                  <span className="ml-auto text-xs text-slate-400">{fromNow(entry.created_at)}</span>
                  <button type="button" className="text-xs text-emerald-600 hover:underline" onClick={() => removeBlacklist(entry)}>
                    解除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Modal
        open={Boolean(editing)}
        title={`编辑成员：${editing?.username ?? ''}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={saveMember}>
              保存
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {isOwner && editing?.role !== 'owner' && (
            <Field label="身份">
              <select
                className="input"
                value={editForm.role}
                onChange={(event) => setEditForm({ ...editForm, role: event.target.value })}
              >
                <option value="member">普通成员</option>
                <option value="admin">团队管理员</option>
              </select>
            </Field>
          )}
          <Field label="组别" hint="组别权限可在「团队设置」里配置">
            <select
              className="input"
              value={editForm.groupId}
              onChange={(event) => setEditForm({ ...editForm, groupId: event.target.value })}
            >
              <option value="">不分组</option>
              {(data?.groups ?? []).map((group: any) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="团队内昵称">
            <input
              className="input"
              value={editForm.nickname}
              onChange={(event) => setEditForm({ ...editForm, nickname: event.target.value })}
              placeholder="留空则显示原昵称"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={banOpen}
        title="拉黑用户"
        onClose={() => setBanOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setBanOpen(false)}>
              取消
            </button>
            <button type="button" className="btn-danger" onClick={addBlacklist}>
              拉黑
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="用户名" required>
            <input className="input" value={banUser} onChange={(event) => setBanUser(event.target.value)} />
          </Field>
          <Field label="原因">
            <input className="input" value={banReason} onChange={(event) => setBanReason(event.target.value)} />
          </Field>
          <p className="text-xs text-slate-400">拉黑后该用户会被移出团队，且无法再次申请或加入。</p>
        </div>
      </Modal>
    </div>
  );
}
