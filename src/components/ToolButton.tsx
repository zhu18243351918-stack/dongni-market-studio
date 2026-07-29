import * as Tooltip from '@radix-ui/react-tooltip';
import type { LucideIcon } from 'lucide-react';
import type { ToolId } from '../types';

interface ToolButtonProps {
  id: ToolId;
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  active: boolean;
  onClick: (tool: ToolId) => void;
}

export function ToolButton({ id, label, shortcut, icon: Icon, active, onClick }: ToolButtonProps) {
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          className={`tool-button ${active ? 'is-active' : ''}`}
          aria-label={label}
          aria-pressed={active}
          onClick={() => onClick(id)}
        >
          <Icon size={19} strokeWidth={1.8} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip-content" side="right" sideOffset={10}>
          <span>{label}</span>
          {shortcut && <kbd>{shortcut}</kbd>}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
