import { Carrot } from 'lucide-react';

type BrandLockupProps = {
  compact?: boolean;
  fixedLight?: boolean;
  className?: string;
};

export function BrandLockup({ compact = false, fixedLight = false, className = '' }: BrandLockupProps) {
  const classes = [
    'system-brand',
    compact ? 'system-brand--compact' : '',
    fixedLight ? 'system-brand--fixed-light' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <span className={classes} aria-label="东尼菜市场 Studio">
      <span className="system-brand__mark" aria-hidden="true">
        <Carrot strokeWidth={2.35} />
      </span>
      <span className="system-brand__copy">
        <strong className="system-brand__name">东尼菜市场</strong>
        <small className="system-brand__meta">STUDIO</small>
      </span>
    </span>
  );
}
