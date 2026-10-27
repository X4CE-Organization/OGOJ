import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, UserCog } from 'lucide-react';
import { api, query } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { runBulk } from '../../lib/bulk';
import { classNames, formatTime, fromNow } from '../../lib/format';
import { Avatar, BulkBar, EmptyState, Field, Loading, Modal, Pagination } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function UsersPanel() {
  const { user: me, isSuperAdmin } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [banned, setBanned] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkRole, setBulkRole] = useState('user');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: '',
    password: '',
    displayName: '',
    email: '',
    role: 'user',
    points: 0,
    isPrivate: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(
        `/api/admin/users${query({ page, size: 50, q: search, role, banned })}`,
      );
      setData(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, role, banned]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelected([]);
  }, [page, search, role, banned]);

  const openEditor = (user: any) => {
    setEditing(user);
    setForm({
      role: user.role,
      isBanned: Boolean(user.is_banned),
      banReason: user.ban_reason ?? '',
      points: 0,
      password: '',
      username: user.username ?? '',
      display_name: user.display_name ?? '',
      email: user.email ?? '',
    });
  };

  const save = async () => {
    if (!editing) return;
    try {
      const payload: any = {
        isBanned: form.isBanned,
        banReason: form.banReason,
        profile: {
          display_name: form.display_name,
          email: form.email,
          ...(isSuperAdmin ? { username: form.username } : {}),
        },
      };
      if (isSuperAdmin) {
        payload.role = form.role;
        if (form.points) payload.points = Number(form.points);
        if (form.password) payload.password = form.password;
      }
      await api.put(`/api/admin/users/${editing.id}`, payload);
      toast.success('已保存');
      setEditing(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const quickBan = async (user: any) => {
    const reason = user.is_banned ? '' : window.prompt('封禁原因', '违反社区规范') ?? '';
    try {
      await api.put(`/api/admin/users/${user.id}`, { isBanned: !user.is_banned, banReason: reason });
      toast.success(user.is_banned ? '已解封' : '已封禁');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const remove = async (user: any) => {
    if (!window.confirm(`确定删除用户 ${user.username} 及其全部数据吗？此操作不可恢复。`)) return;
    try {
      await api.del(`/api/admin/users/${user.id}`);
      toast.success('用户已删除');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const users: any[] = data?.items ?? [];
  const selectedUsers = users.filter((item) => selected.includes(item.id));
  const allSelected = users.length > 0 && users.every((item) => selected.includes(item.id));
  const toggleOne = (id: number) => {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };
  const toggleAll = () => {
    const ids = users.map((item) => item.id);
    setSelected((current) => (allSelected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]));
  };

  const finishBulk = async (label: string, result: Awaited<ReturnType<typeof runBulk>>) => {
    setBulkBusy(false);
    setSelected([]);
    if (result.succeeded) toast.success(`${label}：成功 ${result.succeeded} 位用户`);
    if (result.failures.length) {
      toast.error(`${label}：失败 ${result.failures.length} 位，${result.failures[0].message}`);
    }
    void load();
  };

  const bulkBan = async (isBanned: boolean) => {
    const chosen = selectedUsers.filter((item) => item.id !== me?.id && item.role !== 'superadmin');
    if (!chosen.length) {
      toast.error('没有可操作的用户（不能批量封禁自己或超级管理员）');
      return;
    }
    const reason = isBanned ? window.prompt('批量封禁原因', '违反社区规范') ?? '' : '';
    setBulkBusy(true);
    const result = await runBulk(
      chosen,
      (item) => api.put(`/api/admin/users/${item.id}`, { isBanned, banReason: reason }),
      { id: (item) => item.id, label: (item) => item.username },
    );
    await finishBulk(isBanned ? '批量封禁' : '批量解封', result);
  };

  const bulkDelete = async () => {
    const chosen = selectedUsers.filter((item) => item.id !== me?.id && item.role !== 'superadmin');
    if (!chosen.length || !window.confirm(`确定永久删除选中的 ${chosen.length} 位用户及全部数据吗？`)) return;
    setBulkBusy(true);
    const result = await runBulk(
      chosen,
      (item) => api.del(`/api/admin/users/${item.id}`),
      { id: (item) => item.id, label: (item) => item.username },
    );
    await finishBulk('批量删除', result);
  };

  const bulkSetRole = async () => {
    const chosen = selectedUsers.filter((item) => item.id !== me?.id);
    if (!chosen.length) return;
    setBulkBusy(true);
    const result = await runBulk(
      chosen,
      (item) => api.put(`/api/admin/users/${item.id}`, { role: bulkRole }),
      { id: (item) => item.id, label: (item) => item.username },
    );
    await finishBulk('批量调整角色', result);
  };

  const bulkPoints = async () => {
    const raw = window.prompt('输入批量调整的积分（正数增加，负数扣减）', '10');
    if (raw === null) return;
    const points = Number(raw);
    if (!Number.isFinite(points) || points === 0) {
      toast.error('请输入非零数字');
      return;
    }
    setBulkBusy(true);
    const result = await runBulk(
      selectedUsers,
      (item) => api.put(`/api/admin/users/${item.id}`, { points }),
      { id: (item) => item.id, label: (item) => item.username },
    );
    await finishBulk('批量调整积分', result);
  };

  const createUser = async () => {
    setCreating(true);
    try {
      await api.post('/api/admin/users', createForm);
      toast.success(`用户 ${createForm.username} 已创建`);
      setCreateOpen(false);
      setCreateForm({
        username: '',
        password: '',
        displayName: '',
        email: '',
        role: 'user',
        points: 0,
        isPrivate: false,
      });
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建用户失败');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">用户管理</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">共 {data?.total ?? 0} 位用户</span>
          {isSuperAdmin ? (
            <button type="button" className="btn-primary !py-1.5 text-xs" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> 新增用户
            </button>
          ) : null}
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <input
          className="input !w-full sm:!w-56"
          placeholder="搜索用户名 / 昵称 / 邮箱"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <select
          className="input !w-full sm:!w-36"
          value={role}
          onChange={(event) => {
            setRole(event.target.value);
            setPage(1);
          }}
        >
          <option value="">全部角色</option>
          <option value="user">普通用户</option>
          <option value="admin">普通管理员</option>
          <option value="superadmin">超级管理员</option>
        </select>
        <select
          className="input !w-full sm:!w-36"
          value={banned}
          onChange={(event) => {
            setBanned(event.target.value);
            setPage(1);
          }}
        >
          <option value="">全部状态</option>
          <option value="false">正常</option>
          <option value="true">已封禁</option>
        </select>
      </div>

      <BulkBar count={selected.length} onClear={() => setSelected([])} busy={bulkBusy}>
        <button type="button" className="btn-ghost !py-1 text-xs" disabled={bulkBusy} onClick={() => void bulkBan(true)}>
          封禁
        </button>
        <button type="button" className="btn-ghost !py-1 text-xs" disabled={bulkBusy} onClick={() => void bulkBan(false)}>
          解封
        </button>
        {isSuperAdmin && (
          <>
            <select className="input !w-32 !py-1 text-xs" value={bulkRole} onChange={(event) => setBulkRole(event.target.value)}>
              <option value="user">普通用户</option>
              <option value="admin">普通管理员</option>
              <option value="superadmin">超级管理员</option>
            </select>
            <button type="button" className="btn-ghost !py-1 text-xs" disabled={bulkBusy} onClick={() => void bulkSetRole()}>
              应用角色
            </button>
            <button type="button" className="btn-ghost !py-1 text-xs" disabled={bulkBusy} onClick={() => void bulkPoints()}>
              调整积分
            </button>
            <button type="button" className="btn-ghost !py-1 text-xs text-rose-600" disabled={bulkBusy} onClick={() => void bulkDelete()}>
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </button>
          </>
        )}
      </BulkBar>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="没有找到用户" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-10">
                    <input type="checkbox" aria-label="全选本页用户" checked={allSelected} onChange={toggleAll} />
                  </th>
                  <th className="w-16">ID</th>
                  <th>用户</th>
                  <th className="w-28">角色</th>
                  <th className="w-24">积分</th>
                  <th className="w-24">通过题目</th>
                  <th className="w-40">最近登录</th>
                  <th className="w-40">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((user: any) => (
                  <tr
                    key={user.id}
                    className={classNames(user.is_banned && 'opacity-60', selected.includes(user.id) && 'bg-primary/5')}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择用户 ${user.username}`}
                        checked={selected.includes(user.id)}
                        onChange={() => toggleOne(user.id)}
                      />
                    </td>
                    <td className="text-xs text-slate-400">{user.id}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Avatar user={user} size={30} />
                        <div>
                          <Link to={`/user/${user.username}`} className="hover:text-primary">
                            {user.display_name || user.username}
                          </Link>
                          {Boolean(user.is_banned) && (
                            <span className="ml-2 rounded bg-rose-100 px-1 text-[10px] text-rose-600 dark:bg-rose-500/20">
                              已封禁
                            </span>
                          )}
                          <div className="font-mono text-[11px] text-slate-400">@{user.username}</div>
                          <div className="text-[11px] text-slate-400">{user.email || '未填写邮箱'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-xs">
                      {user.role === 'superadmin' ? '超级管理员' : user.role === 'admin' ? '普通管理员' : '普通用户'}
                    </td>
                    <td className="text-primary">{user.points}</td>
                    <td>{user.solved_count}</td>
                    <td className="text-xs text-slate-400">
                      {user.last_login_at ? fromNow(user.last_login_at) : '从未'}
                      <div className="text-[11px]">{user.last_login_ip ?? ''}</div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2 text-xs">
                        <button type="button" className="text-primary hover:underline" onClick={() => openEditor(user)}>
                          <UserCog className="mr-0.5 inline h-3.5 w-3.5" />
                          编辑
                        </button>
                        <button
                          type="button"
                          className={user.is_banned ? 'text-emerald-600 hover:underline' : 'text-amber-600 hover:underline'}
                          onClick={() => quickBan(user)}
                        >
                          {user.is_banned ? '解封' : '封禁'}
                        </button>
                        {isSuperAdmin && user.role !== 'superadmin' && (
                          <button type="button" className="text-rose-500 hover:underline" onClick={() => remove(user)}>
                            <Trash2 className="inline h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} size={50} total={data?.total ?? 0} onChange={setPage} />
      </div>

      <Modal
        open={Boolean(editing)}
        title={`编辑用户：${editing?.username ?? ''}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={save}>
              保存
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {isSuperAdmin && (
            <Field label="用户名" hint="登录名与个人主页地址，全站唯一（区分大小写）">
              <input
                className="input"
                value={form.username ?? ''}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
              />
            </Field>
          )}
          <Field label="昵称" hint="显示用，可以和其他人重复">
            <input
              className="input"
              value={form.display_name ?? ''}
              onChange={(event) => setForm({ ...form, display_name: event.target.value })}
            />
          </Field>
          <Field label="邮箱">
            <input
              className="input"
              value={form.email ?? ''}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>
          {isSuperAdmin ? (
            <>
              <Field label="角色">
                <select
                  className="input"
                  value={form.role ?? 'user'}
                  onChange={(event) => setForm({ ...form, role: event.target.value })}
                >
                  <option value="user">普通用户</option>
                  <option value="admin">普通管理员</option>
                  <option value="superadmin">超级管理员</option>
                </select>
              </Field>
              <Field label="调整积分" hint="正数为增加，负数为扣减；留空表示不修改">
                <input
                  className="input"
                  type="number"
                  value={form.points ?? ''}
                  onChange={(event) => setForm({ ...form, points: event.target.value })}
                />
              </Field>
              <Field label="重置密码" hint="留空表示不修改">
                <input
                  className="input"
                  type="text"
                  value={form.password ?? ''}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  placeholder="输入新密码"
                />
              </Field>
            </>
          ) : (
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              只有超级管理员可以调整角色、积分与密码。
            </p>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={Boolean(form.isBanned)}
              onChange={(event) => setForm({ ...form, isBanned: event.target.checked })}
            />
            封禁该用户
          </label>
          {form.isBanned && (
            <Field label="封禁原因">
              <input
                className="input"
                value={form.banReason ?? ''}
                onChange={(event) => setForm({ ...form, banReason: event.target.value })}
              />
            </Field>
          )}
          {editing && (
            <p className="text-xs text-slate-400">
              注册于 {formatTime(editing.created_at)} · 提交 {editing.submission_count} 次
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={createOpen}
        title="新增用户"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" disabled={creating} onClick={() => void createUser()}>
              {creating ? '创建中…' : '创建用户'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="用户名" required hint="登录名，区分大小写">
              <input
                className="input"
                value={createForm.username}
                onChange={(event) => setCreateForm({ ...createForm, username: event.target.value })}
              />
            </Field>
            <Field label="初始密码" required>
              <input
                className="input"
                type="text"
                value={createForm.password}
                onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })}
              />
            </Field>
            <Field label="昵称">
              <input
                className="input"
                value={createForm.displayName}
                onChange={(event) => setCreateForm({ ...createForm, displayName: event.target.value })}
                placeholder="留空则与用户名相同"
              />
            </Field>
            <Field label="邮箱">
              <input
                className="input"
                type="email"
                value={createForm.email}
                onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })}
              />
            </Field>
            <Field label="角色">
              <select
                className="input"
                value={createForm.role}
                onChange={(event) => setCreateForm({ ...createForm, role: event.target.value })}
              >
                <option value="user">普通用户</option>
                <option value="admin">普通管理员</option>
                <option value="superadmin">超级管理员</option>
              </select>
            </Field>
            <Field label="初始积分">
              <input
                className="input"
                type="number"
                value={createForm.points}
                onChange={(event) => setCreateForm({ ...createForm, points: Number(event.target.value) })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={createForm.isPrivate}
              onChange={(event) => setCreateForm({ ...createForm, isPrivate: event.target.checked })}
            />
            默认隐藏个人主页
          </label>
        </div>
      </Modal>
    </div>
  );
}
