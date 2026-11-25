import type { ComponentChildren } from 'preact';
import { AlertIcon, CheckIcon } from './Icons';

export function ToggleSwitch({
  checked,
  disabled,
  id,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  id?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      class={`relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full border transition-colors ${
        checked
          ? 'bg-[var(--bt-accent)] border-[var(--bt-accent)]'
          : 'bg-[var(--bt-border-strong)] border-[var(--bt-border-strong)]'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        class={`inline-block h-[14px] w-[14px] rounded-full bg-[var(--bt-surface)] shadow-sm transition-transform ${
          checked ? 'translate-x-[17px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}

export function StatusNotice({
  tone,
  children,
}: {
  tone: 'success' | 'error' | 'warning' | 'info';
  children: ComponentChildren;
}) {
  const styles =
    tone === 'success'
      ? 'bg-[var(--bt-success-soft)] text-[var(--bt-success)] border-[var(--bt-success)]/30'
      : tone === 'error'
        ? 'bg-[var(--bt-danger-soft)] text-[var(--bt-danger)] border-[var(--bt-danger)]/30'
        : tone === 'warning'
          ? 'bg-[var(--bt-warning-soft)] text-[var(--bt-warning)] border-[var(--bt-warning)]/30'
          : 'bg-[var(--bt-accent-soft)] text-[var(--bt-text)] border-[var(--bt-accent)]/25';

  return (
    <div
      role="status"
      class={`flex items-start gap-2 rounded-[10px] border px-3 py-2 text-[13px] leading-snug ${styles}`}
    >
      {tone === 'success' ? (
        <CheckIcon size={16} class="mt-0.5" />
      ) : (
        <AlertIcon size={16} class="mt-0.5" />
      )}
      <div class="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  compact = false,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  compact?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      class="inline-flex rounded-[8px] border border-[var(--bt-border)] bg-[var(--bt-surface-subtle)] p-0.5 gap-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            class={`rounded-[6px] cursor-pointer ${
              compact ? 'px-2 py-0.5 text-[12px]' : 'px-3 py-1.5 text-[13px]'
            } ${
              active
                ? 'bg-[var(--bt-surface)] text-[var(--bt-text)] font-medium shadow-xs'
                : 'text-[var(--bt-text-muted)] hover:text-[var(--bt-text)]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
