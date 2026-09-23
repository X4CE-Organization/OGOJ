import type { FastifyInstance } from 'fastify';
import { all, count, get, run, tx } from '../db/index.js';
import { hasRole, requireAdmin, requireUser } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { bool, num } from '../settings/index.js';
import { parseId, parsePage } from '../lib/util.js';
import { randomCode } from '../lib/crypto.js';
import { addPoints, spendPoints } from '../lib/points.js';
import { sendMessage, notifyAdmins } from '../lib/notify.js';

function orderNo(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `OG${stamp}${randomCode(6)}`;
}

export async function registerShopRoutes(app: FastifyInstance): Promise<void> {
  /* ----------------------------------------------------------------- items */
  app.get('/api/shop/items', async (request) => {
    const query = request.query as any;
    const conditions = ['1 = 1'];
    const params: unknown[] = [];
    if (!hasRole(request.user, 'admin') || query.all !== 'true') conditions.push('is_active = 1');
    if (query.kind) {
      conditions.push('kind = ?');
      params.push(String(query.kind));
    }
    const items = all<any>(
      `SELECT * FROM shop_items WHERE ${conditions.join(' AND ')} ORDER BY sort ASC, price ASC, id ASC`,
    );
    void params;
    const sold = all<any>(
      `SELECT item_id, COUNT(*) AS c FROM shop_orders WHERE status IN ('pending', 'approved') GROUP BY item_id`,
    );
    const soldMap = new Map(sold.map((row) => [row.item_id, row.c]));
    return {
      enabled: bool('enable_points', true) && bool('shop_enabled', true),
      items: items
        .filter((item) => bool('shop_show_sold_out', true) || item.stock < 0 || item.stock > (soldMap.get(item.id) ?? 0))
        .map((item) => ({
          ...item,
          payload: JSON.parse(item.payload || '{}'),
          soldCount: soldMap.get(item.id) ?? 0,
          soldOut: item.stock >= 0 && (soldMap.get(item.id) ?? 0) >= item.stock,
        })),
    };
  });

  /* ---------------------------------------------------------------- orders */
  app.get('/api/shop/orders', async (request) => {
    const user = requireUser(request);
    const query = request.query as any;
    const page = parsePage(query, 30);
    const conditions = ['o.user_id = ?'];
    const params: unknown[] = [user.id];
    if (query.status) {
      conditions.push('o.status = ?');
      params.push(String(query.status));
    }
    const items = all<any>(
      `SELECT o.*, s.icon FROM shop_orders o LEFT JOIN shop_items s ON s.id = o.item_id
        WHERE ${conditions.join(' AND ')} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(`SELECT COUNT(*) AS c FROM shop_orders o WHERE ${conditions.join(' AND ')}`, params);
    return {
      items: items.map((item) => ({ ...item, payload: JSON.parse(item.payload || '{}') })),
      total,
      page: page.page,
      size: page.size,
      points: get<{ points: number }>('SELECT points FROM users WHERE id = ?', [user.id])?.points ?? 0,
    };
  });

  /* --------------------------------------------------------------- redeem */
  app.post('/api/shop/redeem', async (request) => {
    const user = requireUser(request);
    if (!bool('enable_points', true)) throw forbidden('积分系统未开启');
    if (!bool('shop_enabled', true)) throw forbidden('商店未开启');
    const body = (request.body ?? {}) as any;
    const item = get<any>('SELECT * FROM shop_items WHERE id = ? AND is_active = 1', [Number(body.itemId)]);
    if (!item) throw notFound('商品不存在或已下架');

    const soldCount = count(
      `SELECT COUNT(*) AS c FROM shop_orders WHERE item_id = ? AND status IN ('pending', 'approved', 'completed')`,
      [item.id],
    );
    if (item.stock >= 0 && soldCount >= item.stock) throw conflict('该商品已售罄');
    if (item.max_per_user > 0) {
      const mine = count(
        `SELECT COUNT(*) AS c FROM shop_orders WHERE item_id = ? AND user_id = ? AND status IN ('pending', 'approved', 'completed')`,
        [item.id, user.id],
      );
      if (mine >= item.max_per_user) throw conflict(`每人最多兑换 ${item.max_per_user} 次`);
    }

    const balance = get<{ points: number }>('SELECT points FROM users WHERE id = ?', [user.id])?.points ?? 0;
    if (balance < item.price) {
      throw badRequest(`积分不足：当前 ${balance} 分，需要 ${item.price} 分`);
    }

    let payload: Record<string, unknown> = {};
    if (body.payload && typeof body.payload === 'object') payload = body.payload as Record<string, unknown>;
    if (item.kind === 'contest' && !String(payload.title ?? '').trim()) {
      throw badRequest('请填写比赛名称');
    }
    if (item.kind === 'problem' && !String(payload.title ?? '').trim()) {
      throw badRequest('请填写题目名称');
    }

    const autoApprove = !bool('shop_order_need_review', true) || hasRole(user, 'admin');
    const orderId = tx(() => {
      spendPoints(user.id, item.price, `兑换「${item.name}」`, { refType: 'shop', refId: item.id });
      const info = run(
        `INSERT INTO shop_orders (order_no, user_id, item_id, item_name, kind, price, status, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderNo(),
          user.id,
          item.id,
          item.name,
          item.kind,
          item.price,
          autoApprove ? 'approved' : 'pending',
          JSON.stringify(payload),
        ],
      );
      const id = Number(info.lastInsertRowid);
      if (autoApprove) grantOrder(id);
      return id;
    });

    audit(request, 'shop.redeem', { targetType: 'order', targetId: orderId, detail: { item: item.name } });
    sendMessage({
      to: user.id,
      title: autoApprove ? '兑换成功' : '兑换申请已提交',
      content: autoApprove
        ? `你已成功兑换「${item.name}」，消耗 ${item.price} 积分，权限已发放。`
        : `你已提交「${item.name}」的兑换申请，消耗 ${item.price} 积分，等待管理员审核。`,
      type: 'shop',
      refType: 'order',
      refId: orderId,
      setting: 'notify_on_shop',
    });
    if (!autoApprove) {
      notifyAdmins('有新的商店兑换申请', `用户 ${user.username} 申请兑换「${item.name}」`, {
        refType: 'order',
        refId: orderId,
      });
    }
    return { ok: true, orderId, status: autoApprove ? 'approved' : 'pending' };
  });

  app.post('/api/shop/orders/:id/cancel', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const order = get<any>('SELECT * FROM shop_orders WHERE id = ? AND user_id = ?', [id, user.id]);
    if (!order) throw notFound('订单不存在');
    if (order.status !== 'pending') throw conflict('只有待审核的订单可以取消');
    tx(() => {
      run(`UPDATE shop_orders SET status = 'cancelled' WHERE id = ?`, [id]);
      if (bool('shop_refund_on_reject', true)) {
        addPoints(user.id, order.price, `取消订单退还积分（${order.item_name}）`, {
          refType: 'order',
          refId: order.id,
        });
      }
    });
    return { ok: true };
  });

  /* --------------------------------------------------------- admin 后台管理 */
  app.get('/api/admin/shop/items', async (request) => {
    requireAdmin(request);
    const items = all<any>('SELECT * FROM shop_items ORDER BY sort ASC, id ASC');
    return {
      items: items.map((item) => ({ ...item, payload: JSON.parse(item.payload || '{}') })),
    };
  });

  app.post('/api/admin/shop/items', async (request) => {
    const admin = requireAdmin(request);
    const body = (request.body ?? {}) as any;
    const name = String(body.name ?? '').trim();
    if (!name) throw badRequest('商品名称不能为空');
    const slug = String(body.slug ?? '').trim() || `item-${Date.now().toString(36)}`;
    if (get('SELECT id FROM shop_items WHERE slug = ?', [slug])) throw conflict('商品标识已存在');
    const info = run(
      `INSERT INTO shop_items (name, slug, description, icon, price, kind, stock, max_per_user, is_active, sort, payload, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        slug,
        String(body.description ?? ''),
        String(body.icon ?? 'package'),
        Math.max(0, Number(body.price ?? 100) || 0),
        ['contest', 'problem', 'vip', 'custom'].includes(body.kind) ? body.kind : 'custom',
        Number.isFinite(Number(body.stock)) ? Number(body.stock) : -1,
        Math.max(0, Number(body.maxPerUser ?? 0) || 0),
        body.isActive === false ? 0 : 1,
        Number(body.sort ?? 0) || 0,
        JSON.stringify(body.payload ?? {}),
        admin.id,
      ],
    );
    audit(request, 'shop.item_create', { targetType: 'shop_item', targetId: Number(info.lastInsertRowid) });
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  app.put('/api/admin/shop/items/:id', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    const map: [string, string][] = [
      ['name', 'name'],
      ['description', 'description'],
      ['icon', 'icon'],
    ];
    for (const [key, column] of map) {
      if (body[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(String(body[key]));
      }
    }
    if (body.price !== undefined) {
      fields.push('price = ?');
      values.push(Math.max(0, Number(body.price) || 0));
    }
    if (body.kind !== undefined && ['contest', 'problem', 'vip', 'custom'].includes(body.kind)) {
      fields.push('kind = ?');
      values.push(body.kind);
    }
    if (body.stock !== undefined) {
      fields.push('stock = ?');
      values.push(Number(body.stock));
    }
    if (body.maxPerUser !== undefined) {
      fields.push('max_per_user = ?');
      values.push(Math.max(0, Number(body.maxPerUser) || 0));
    }
    if (body.isActive !== undefined) {
      fields.push('is_active = ?');
      values.push(body.isActive ? 1 : 0);
    }
    if (body.sort !== undefined) {
      fields.push('sort = ?');
      values.push(Number(body.sort) || 0);
    }
    if (body.payload !== undefined) {
      fields.push('payload = ?');
      values.push(JSON.stringify(body.payload));
    }
    if (!fields.length) throw badRequest('没有需要更新的字段');
    fields.push(`updated_at = datetime('now')`);
    run(`UPDATE shop_items SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    audit(request, 'shop.item_update', { targetType: 'shop_item', targetId: id, detail: Object.keys(body) });
    return { ok: true };
  });

  app.delete('/api/admin/shop/items/:id', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    run('DELETE FROM shop_items WHERE id = ?', [id]);
    audit(request, 'shop.item_delete', { targetType: 'shop_item', targetId: id });
    return { ok: true };
  });

  app.get('/api/admin/shop/orders', async (request) => {
    requireAdmin(request);
    const query = request.query as any;
    const page = parsePage(query, 30);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.status) {
      conditions.push('o.status = ?');
      params.push(String(query.status));
    }
    if (query.kind) {
      conditions.push('o.kind = ?');
      params.push(String(query.kind));
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const items = all<any>(
      `SELECT o.*, u.username, u.points FROM shop_orders o JOIN users u ON u.id = o.user_id
        ${where} ORDER BY CASE o.status WHEN 'pending' THEN 0 ELSE 1 END, o.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(
      `SELECT COUNT(*) AS c FROM shop_orders o JOIN users u ON u.id = o.user_id ${where}`,
      params,
    );
    return {
      items: items.map((item) => ({ ...item, payload: JSON.parse(item.payload || '{}') })),
      total,
      page: page.page,
      size: page.size,
      pending: count(`SELECT COUNT(*) AS c FROM shop_orders WHERE status = 'pending'`),
    };
  });

  app.post('/api/admin/shop/orders/:id/review', async (request) => {
    const admin = requireAdmin(request);
    const id = parseId((request.params as any).id);
    const body = (request.body ?? {}) as any;
    const approve = body.approve !== false;
    const order = get<any>('SELECT * FROM shop_orders WHERE id = ?', [id]);
    if (!order) throw notFound('订单不存在');
    if (order.status !== 'pending') throw conflict('该订单已被处理');

    tx(() => {
      run(
        `UPDATE shop_orders SET status = ?, handled_by = ?, handled_at = datetime('now'), note = ? WHERE id = ?`,
        [approve ? 'approved' : 'rejected', admin.id, String(body.note ?? ''), id],
      );
      if (approve) {
        grantOrder(id);
      } else if (bool('shop_refund_on_reject', true)) {
        addPoints(order.user_id, order.price, `订单被驳回，退还积分（${order.item_name}）`, {
          refType: 'order',
          refId: id,
        });
      }
    });
    sendMessage({
      to: order.user_id,
      title: approve ? '兑换申请已通过' : '兑换申请被驳回',
      content: approve
        ? `你申请的「${order.item_name}」已通过审核，权限已发放到你的账号。`
        : `你申请的「${order.item_name}」被驳回${body.note ? `：${body.note}` : ''}，积分已退还。`,
      type: 'shop',
      refType: 'order',
      refId: id,
    });
    audit(request, 'shop.order_review', { targetType: 'order', targetId: id, detail: { approve } });
    return { ok: true };
  });

  /* ----------------------------------------------------------- 商品预设 */
  app.get('/api/shop/presets', async () => {
    return {
      presets: [
        {
          slug: 'create-contest',
          name: '创建一次比赛',
          kind: 'contest',
          price: num('shop_default_contest_price', 100),
          description: '兑换后可获得一次创建自定义比赛的资格，创建后需等待管理员审核。',
          icon: 'trophy',
        },
        {
          slug: 'create-problem',
          name: '出一道题',
          kind: 'problem',
          price: num('shop_default_problem_price', 60),
          description: '兑换后可获得一次出题资格，可上传测试数据，审核通过后进入题库。',
          icon: 'file-plus',
        },
      ],
    };
  });
}

/** Grant the quota tied to an approved order. */
function grantOrder(orderId: number): void {
  const order = get<any>('SELECT * FROM shop_orders WHERE id = ?', [orderId]);
  if (!order) return;
  if (order.kind === 'contest' || order.kind === 'problem') {
    run(
      `INSERT INTO grants (user_id, kind, total, used, order_id, note) VALUES (?, ?, 1, 0, ?, ?)`,
      [order.user_id, order.kind, order.id, order.item_name],
    );
  }
  if (order.kind === 'custom') {
    const payload = JSON.parse(order.payload || '{}');
    if (payload.grantKind === 'contest' || payload.grantKind === 'problem') {
      run(
        `INSERT INTO grants (user_id, kind, total, used, order_id, note) VALUES (?, ?, ?, 0, ?, ?)`,
        [order.user_id, payload.grantKind, Math.max(1, Number(payload.total ?? 1)), order.id, order.item_name],
      );
    }
  }
  run(`UPDATE shop_orders SET status = 'completed' WHERE id = ? AND status = 'approved'`, [orderId]);
}
