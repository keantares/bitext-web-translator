interface IconProps {
  class?: string;
  size?: number;
}

function Svg({
  size = 18,
  class: className = '',
  children,
}: IconProps & { children: preact.ComponentChildren }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M8.6 2.8h2.8l.4 2 1.5.7 1.7-1.1 2 2-1.1 1.7.7 1.5 2 .4v2.8l-2 .4-.7 1.5 1.1 1.7-2 2-1.7-1.1-1.5.7-.4 2H8.6l-.4-2-1.5-.7-1.7 1.1-2-2 1.1-1.7-.7-1.5-2-.4V8.6l2-.4.7-1.5-1.1-1.7 2-2 1.7 1.1 1.5-.7z" />
    </Svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="10" r="7.2" />
      <ellipse cx="10" cy="10" rx="3.1" ry="7.2" />
      <path d="M3 10h14" />
    </Svg>
  );
}

export function SwapIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h11l-3-3M16 13H5l3 3" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 10.5 8.2 14.2 15.5 6.5" />
    </Svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6.2v4.3M10 13.6h.01" />
    </Svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="7" y="7" width="9" height="9" rx="2" />
      <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7.5 5l5 5-5 5" />
    </Svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 3.5v9M6.5 9.2 10 12.8l3.5-3.6M4 15.5h12" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 6h11M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6M6 6l.7 9.6a1.4 1.4 0 0 0 1.4 1.4h3.8a1.4 1.4 0 0 0 1.4-1.4L14 6" />
    </Svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 10s2.8-4.8 7.5-4.8S17.5 10 17.5 10s-2.8 4.8-7.5 4.8S2.5 10 2.5 10z" />
      <circle cx="10" cy="10" r="2.2" />
    </Svg>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 3l14 14M8.5 5.4A7.6 7.6 0 0 1 10 5.2c4.7 0 7.5 4.8 7.5 4.8a13 13 0 0 1-2.5 3M5.3 7.2A12.8 12.8 0 0 0 2.5 10s2.8 4.8 7.5 4.8c1 0 2-.2 2.8-.6" />
    </Svg>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 3.2 11.4 7.6 15.8 9l-4.4 1.4L10 14.8l-1.4-4.4L4.2 9l4.4-1.4z" />
      <path d="M15.5 3.5v2.4M14.3 4.7h2.4M4.5 14v2M3.5 15h2" />
    </Svg>
  );
}

export function ServerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3.5" width="14" height="5.2" rx="1.6" />
      <rect x="3" y="11.3" width="14" height="5.2" rx="1.6" />
      <circle cx="6.2" cy="6.1" r="0.6" fill="currentColor" />
      <circle cx="6.2" cy="13.9" r="0.6" fill="currentColor" />
    </Svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16 10a6 6 0 1 1-1.6-4.1M16 4v2.8h-2.8" />
    </Svg>
  );
}

// Same drawing as public/icon/logo.svg, colored with the current accent.
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      aria-hidden="true"
      class="shrink-0"
    >
      <rect
        x="1.5"
        y="1.5"
        width="125"
        height="125"
        rx="29"
        fill="var(--bt-accent)"
        stroke="var(--bt-on-accent)"
        stroke-opacity="0.24"
        stroke-width="3"
      />
      <g
        fill="none"
        stroke="var(--bt-on-accent)"
        stroke-width="8.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="m37.5 19.8 4.9 6.2 M19.8 33.8h43.7" />
        <path d="M53.8 34.8c-3.5 15.1-16.6 27.5-33.2 34.1 M29.3 43.3c6.2 9.3 16.1 18.2 29.7 23.5" />
      </g>
      <path
        d="M60.5 103.7 77.2 60.2c.8-2.1 2.3-3.2 4.6-3.2h4.3c2.2 0 3.8 1.1 4.6 3.2l17.1 43.5c.6 1.5-.2 2.4-1.8 2.4h-6.2c-1.5 0-2.2-.6-2.7-2L93.2 94H74.4l-3.7 10.1c-.5 1.4-1.2 2-2.8 2h-5.6c-1.6 0-2.4-.9-1.8-2.4Zm17-18.1h12.6l-6.4-17.5Z"
        fill="var(--bt-on-accent)"
        fill-rule="evenodd"
      />
      <g
        fill="none"
        stroke="var(--bt-on-accent)"
        stroke-width="5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M76 26h12a13 13 0 0 1 13 13v5m-6-5 6 6 6-6" />
        <path d="M50 101H38a13 13 0 0 1-13-13v-5m-6 5 6-6 6 6" />
      </g>
    </svg>
  );
}
