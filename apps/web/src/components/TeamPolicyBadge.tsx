import { classNames } from '../lib/format';
import { teamPolicy } from '../lib/team';

/** 团队公开程度徽章：公开团队（绿）/ 保护团队（蓝）/ 私有团队（红） */
export default function TeamPolicyBadge({
  policy,
  full = false,
  className,
}: {
  policy?: string | null;
  full?: boolean;
  className?: string;
}) {
  const meta = teamPolicy(policy);
  const text = full ? meta.label : meta.short;
  return (
    <span
      title={meta.description}
      className={classNames(
        'inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium',
        className,
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
        color: `color-mix(in srgb, ${meta.color} 72%, ${document.documentElement.classList.contains('dark') ? 'white' : 'black'})`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {text}
    </span>
  );
}
