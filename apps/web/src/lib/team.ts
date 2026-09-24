/**
 * 团队公开程度：名称 + 说明 + 配色。
 *  - 公开团队：自由加入
 *  - 保护团队：加入需要审核
 *  - 私有团队：不允许加入（需要邀请码）
 */
export interface TeamPolicyMeta {
  label: string;
  short: string;
  hint: string;
  color: string;
  description: string;
}

export const TEAM_POLICIES: TeamPolicyMeta[] = [
  {
    label: '公开团队（自由加入）',
    short: '公开团队',
    hint: '自由加入',
    color: '#22c55e',
    description: '任何人都可以直接加入团队。',
  },
  {
    label: '保护团队（加入需要审核）',
    short: '保护团队',
    hint: '加入需要审核',
    color: '#3b82f6',
    description: '申请后需要团长或管理员审核通过才能加入。',
  },
  {
    label: '私有团队（不允许加入）',
    short: '私有团队',
    hint: '不允许加入',
    color: '#ef4444',
    description: '不接受自由申请，需要凭邀请码加入。',
  },
];

export const TEAM_POLICY: Record<string, TeamPolicyMeta> = {
  open: TEAM_POLICIES[0]!,
  approval: TEAM_POLICIES[1]!,
  closed: TEAM_POLICIES[2]!,
};

export function teamPolicy(policy?: string | null): TeamPolicyMeta {
  return TEAM_POLICY[policy ?? 'open'] ?? TEAM_POLICY.open!;
}
