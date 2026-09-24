import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MailOpen, MessageSquarePlus, Search, Send } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, formatTime, fromNow } from '../lib/format';
import { Avatar, EmptyState, Field, Loading, Modal, Pagination, UserLink } from '../components/ui';
import { useToast } from '../components/Toast';

interface Conversation {
  user: {
    id: number;
    username: string;
    display_name: string | null;
    avatar: string | null;
    role: 'user' | 'admin' | 'superadmin';
  };
  unread: number;
  lastMessage: { id: number; content: string; createdAt: string; fromMe: boolean };
  lastActiveAt: string | null;
}

export default function Messages() {
  const { user, settings, refresh } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'system' ? 'system' : 'private');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState('');
  const [peer, setPeer] = useState<any>(null);
  const [thread, setThread] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [notifications, setNotifications] = useState<any>(null);
  const [notifPage, setNotifPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState({ to: '', content: '' });
  const [recipients, setRecipients] = useState<any[]>([]);
  const [openedNotification, setOpenedNotification] = useState<any>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const toParam = params.get('to');

  const loadConversations = useCallback(async (term: string) => {
    setLoadingList(true);
    try {
      const data = await api.get<any>(`/api/messages/conversations${query({ q: term })}`);
      setConversations(data.items ?? []);
    } catch {
      setConversations([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const openConversation = useCallback(
    async (username: string) => {
      if (!username) return;
      setLoadingThread(true);
      try {
        const data = await api.get<any>(`/api/messages/conversation/${encodeURIComponent(username)}`);
        setPeer(data.user);
        setThread(data.messages ?? []);
        void loadConversations('');
        void refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '无法打开会话');
        setPeer(null);
        setThread([]);
      } finally {
        setLoadingThread(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadConversations],
  );

  const loadNotifications = useCallback(async () => {
    try {
      const data = await api.get<any>(
        `/api/messages${query({ page: notifPage, size: 20, system: 'true', unread: unreadOnly ? 'true' : '' })}`,
      );
      setNotifications(data);
    } catch {
      setNotifications(null);
    }
  }, [notifPage, unreadOnly]);

  useEffect(() => {
    void loadConversations('');
  }, [loadConversations]);

  useEffect(() => {
    if (tab === 'system') void loadNotifications();
  }, [tab, loadNotifications]);

  // `/messages?to=someone` opens that conversation directly (profile button).
  useEffect(() => {
    if (!toParam) return;
    setTab('private');
    void openConversation(toParam);
    const next = new URLSearchParams(params);
    next.delete('to');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toParam]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [thread.length]);

  const send = async () => {
    if (!peer) return;
    const content = draft.trim();
    if (!content) {
      toast.error('请输入私信内容');
      return;
    }
    setSending(true);
    try {
      await api.post('/api/messages', { to: peer.username, content });
      setDraft('');
      await openConversation(peer.username);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  const searchRecipients = async (term: string) => {
    setCompose((current) => ({ ...current, to: term }));
    if (!term.trim()) {
      setRecipients([]);
      return;
    }
    try {
      const data = await api.get<any>(`/api/messages/recipients${query({ q: term })}`);
      setRecipients(data.items ?? []);
    } catch {
      setRecipients([]);
    }
  };

  const sendCompose = async () => {
    if (!compose.to.trim() || !compose.content.trim()) {
      toast.error('请填写收件人和内容');
      return;
    }
    const target = compose.to.trim();
    try {
      await api.post('/api/messages', { to: target, content: compose.content });
      setComposeOpen(false);
      setCompose({ to: '', content: '' });
      setRecipients([]);
      setTab('private');
      await openConversation(target);
      toast.success('私信已发送');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发送失败');
    }
  };

  const clearConversation = async () => {
    if (!peer) return;
    if (!window.confirm(`确定删除与 ${peer.display_name || peer.username} 的全部私信吗？`)) return;
    try {
      await api.del(`/api/messages/conversation/${encodeURIComponent(peer.username)}`);
      setPeer(null);
      setThread([]);
      void loadConversations('');
      toast.success('已删除该会话');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const markAllRead = async () => {
    try {
      await api.post('/api/messages/read-all', {});
      toast.success('全部标记为已读');
      void loadNotifications();
      void loadConversations('');
      void refresh();
    } catch {
      /* ignore */
    }
  };

  const openNotification = async (message: any) => {
    try {
      const data = await api.get<any>(`/api/messages/${message.id}`);
      setOpenedNotification(data.message);
      void loadNotifications();
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法打开消息');
    }
  };

  const privateEnabled = settings.enable_private_message !== false;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">站内信</h1>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={markAllRead}>
            <MailOpen className="h-3.5 w-3.5" /> 全部已读
          </button>
          {privateEnabled && (
            <button type="button" className="btn-primary !py-1.5 text-xs" onClick={() => setComposeOpen(true)}>
              <MessageSquarePlus className="h-3.5 w-3.5" /> 发私信
            </button>
          )}
        </div>
      </div>

      <div className="card flex items-center gap-1 p-2">
        {[
          { key: 'private', label: '私信' },
          { key: 'system', label: '系统通知' },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={classNames(
              'rounded-lg px-3 py-1.5 text-sm',
              tab === item.key
                ? 'bg-primary text-white'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
            )}
          >
            {item.label}
            {item.key === 'private' && conversations.some((entry) => entry.unread > 0) ? ' •' : ''}
          </button>
        ))}
      </div>

      {tab === 'private' ? (
        !privateEnabled ? (
          <div className="card p-4 text-sm text-slate-500">本站未开放私信功能。</div>
        ) : (
          <div className="card grid overflow-hidden lg:grid-cols-[300px_1fr]">
            <aside className="border-b border-slate-200 lg:border-b-0 lg:border-r dark:border-slate-800">
              <div className="relative border-b border-slate-100 p-2 dark:border-slate-800">
                <Search className="pointer-events-none absolute left-4 top-4 h-3.5 w-3.5 text-slate-400" />
                <input
                  className="input !pl-8 text-sm"
                  placeholder="搜索联系人或内容"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    void loadConversations(event.target.value);
                  }}
                />
              </div>
              <div className="max-h-[520px] overflow-y-auto">
                {loadingList ? (
                  <Loading />
                ) : conversations.length === 0 ? (
                  <EmptyState title="还没有私信" description="点击右上角「发私信」联系其他用户" />
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {conversations.map((item) => (
                      <li key={item.user.id}>
                        <button
                          type="button"
                          onClick={() => void openConversation(item.user.username)}
                          className={classNames(
                            'flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50',
                            peer?.id === item.user.id && 'bg-primary/10',
                          )}
                        >
                          <Avatar user={item.user} size={36} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">
                                {item.user.display_name || item.user.username}
                              </span>
                              <span className="ml-auto shrink-0 text-[11px] text-slate-400">
                                {fromNow(item.lastMessage.createdAt)}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs text-slate-500">
                                {item.lastMessage.fromMe && <span className="text-slate-400">我：</span>}
                                {item.lastMessage.content}
                              </span>
                              {item.unread > 0 && (
                                <span className="ml-auto shrink-0 rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
                                  {item.unread}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>

            <section className="flex min-h-[520px] flex-col">
              {!peer ? (
                <div className="flex flex-1 items-center justify-center">
                  <EmptyState
                    title="选择左侧的联系人开始聊天"
                    description="也可以从用户主页点击「发私信」直接开启对话"
                    action={
                      <button type="button" className="btn-primary mt-2" onClick={() => setComposeOpen(true)}>
                        <MessageSquarePlus className="h-4 w-4" /> 发私信
                      </button>
                    }
                  />
                </div>
              ) : (
                <>
                  <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
                    <Avatar user={peer} size={34} />
                    <div className="min-w-0">
                      <UserLink user={peer} showAvatar={false} className="text-sm font-medium" />
                      <div className="text-[11px] text-slate-400">
                        {peer.last_login_at ? `最近活跃 ${fromNow(peer.last_login_at)}` : '首次交流'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ml-auto text-xs text-rose-500 hover:underline"
                      onClick={clearConversation}
                    >
                      删除会话
                    </button>
                  </header>

                  <div className="flex-1 space-y-3 overflow-y-auto p-4">
                    {loadingThread ? (
                      <Loading />
                    ) : thread.length === 0 ? (
                      <EmptyState title="还没有消息" description="发送第一条私信打个招呼吧" />
                    ) : (
                      thread.map((message) => (
                        <div
                          key={message.id}
                          className={classNames('flex items-end gap-2', message.fromMe ? 'justify-end' : 'justify-start')}
                        >
                          {!message.fromMe && <Avatar user={message.from ?? peer} size={28} />}
                          <div className="max-w-[70%]">
                            <div
                              className={classNames(
                                'whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm',
                                message.fromMe
                                  ? 'rounded-br-sm bg-primary text-white'
                                  : 'rounded-bl-sm bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
                              )}
                            >
                              {message.content}
                            </div>
                            <div
                              className={classNames(
                                'mt-1 text-[11px] text-slate-400',
                                message.fromMe ? 'text-right' : 'text-left',
                              )}
                            >
                              {formatTime(message.createdAt)}
                              {message.fromMe && <span className="ml-1">{message.isRead ? '已读' : '未读'}</span>}
                            </div>
                          </div>
                          {message.fromMe && <Avatar user={user} size={28} />}
                        </div>
                      ))
                    )}
                    <div ref={bottomRef} />
                  </div>

                  <footer className="border-t border-slate-200 p-3 dark:border-slate-800">
                    <textarea
                      className="input min-h-[80px] resize-none"
                      placeholder="输入私信内容（Ctrl + Enter 发送）"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          void send();
                        }
                      }}
                    />
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">
                        {draft.length} / {String(settings.pm_max_length ?? 2000)} 字符
                      </span>
                      <button type="button" className="btn-primary !py-1.5 text-xs" disabled={sending} onClick={send}>
                        <Send className="h-3.5 w-3.5" /> {sending ? '发送中…' : '发送'}
                      </button>
                    </div>
                  </footer>
                </>
              )}
            </section>
          </div>
        )
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 text-sm dark:border-slate-800">
            <span>
              系统通知
              {notifications ? (
                <span className="ml-1 text-slate-400">（{notifications.unreadSystem ?? 0} 封未读）</span>
              ) : null}
            </span>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(event) => {
                  setUnreadOnly(event.target.checked);
                  setNotifPage(1);
                }}
              />
              只看未读
            </label>
          </div>
          {!notifications ? (
            <Loading />
          ) : notifications.items.length === 0 ? (
            <EmptyState title="没有通知" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {notifications.items.map((message: any) => (
                <li key={message.id} className={classNames(!message.is_read && 'bg-primary/[0.04]')}>
                  <button
                    type="button"
                    onClick={() => void openNotification(message)}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <span
                      className={classNames(
                        'mt-1 h-2 w-2 shrink-0 rounded-full',
                        message.is_read ? 'bg-transparent' : 'bg-primary',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={classNames('truncate', !message.is_read && 'font-semibold')}>{message.title}</span>
                        <span className="ml-auto shrink-0 text-xs text-slate-400">{fromNow(message.created_at)}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{message.content}</p>
                      <div className="mt-1 text-[11px] text-slate-400">
                        来自 {message.from_display || message.from_username || '系统'}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Pagination page={notifPage} size={20} total={notifications?.total ?? 0} onChange={setNotifPage} />
        </div>
      )}

      {openedNotification && (
        <div className="card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{openedNotification.title}</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {formatTime(openedNotification.created_at)} · 来自{' '}
                {openedNotification.from_display || openedNotification.from_username || '系统'}
              </p>
            </div>
            <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setOpenedNotification(null)}>
              ✕
            </button>
          </div>
          <div className="mt-3 whitespace-pre-wrap text-sm">{openedNotification.content}</div>
          <div className="mt-4 flex flex-wrap gap-2">
            {openedNotification.ref_type === 'discussion' && openedNotification.ref_id && (
              <Link to={`/discussion/${openedNotification.ref_id}`} className="btn-ghost !py-1.5 text-xs">
                查看原帖
              </Link>
            )}
            {openedNotification.ref_type === 'submission' && openedNotification.ref_id && (
              <Link to={`/record/${openedNotification.ref_id}`} className="btn-ghost !py-1.5 text-xs">
                查看评测记录
              </Link>
            )}
            {openedNotification.ref_type === 'ticket' && openedNotification.ref_id && (
              <Link to={`/tickets/${openedNotification.ref_id}`} className="btn-ghost !py-1.5 text-xs">
                查看工单
              </Link>
            )}
            {openedNotification.from_username && (
              <button
                type="button"
                className="btn-ghost !py-1.5 text-xs"
                onClick={() => {
                  setOpenedNotification(null);
                  setTab('private');
                  void openConversation(openedNotification.from_username);
                }}
              >
                回复私信
              </button>
            )}
          </div>
        </div>
      )}

      <Modal
        open={composeOpen}
        title="发送私信"
        onClose={() => setComposeOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setComposeOpen(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={sendCompose}>
              <Send className="h-4 w-4" /> 发送
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="收件人" required hint="输入用户名或昵称搜索">
            <input
              className="input"
              value={compose.to}
              onChange={(event) => void searchRecipients(event.target.value)}
              placeholder="例如 alice"
            />
          </Field>
          {recipients.length > 0 && (
            <ul className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
              {recipients.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={() => {
                      setCompose((current) => ({ ...current, to: item.username }));
                      setRecipients([]);
                    }}
                  >
                    <Avatar user={item} size={24} />
                    {item.display_name || item.username}
                    <span className="ml-auto text-xs text-slate-400">@{item.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Field label="内容" required>
            <textarea
              className="input min-h-[140px]"
              value={compose.content}
              onChange={(event) => setCompose({ ...compose, content: event.target.value })}
              placeholder="请输入私信内容…"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
