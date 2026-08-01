import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    ...props,
  };
}

export function IconX(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconO(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="7.25" />
    </svg>
  );
}

export function IconShuffle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M18 2l4 4-4 4" />
      <path d="M18 14l4 4-4 4" />
      <path d="M2 18h1.97a4 4 0 0 0 3.3-1.7l5.46-8.6A4 4 0 0 1 16.03 6H22" />
      <path d="M2 6h1.97a4 4 0 0 1 3.6 2.2" />
      <path d="M22 18h-6.04a4 4 0 0 1-3.3-1.8l-.36-.45" />
    </svg>
  );
}

export function IconZap(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13 2L4 14h7l-1 8 10-14h-8l1-8z" />
    </svg>
  );
}

export function IconTrophy(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 4h8v3a4 4 0 0 1-8 0V4z" />
      <path d="M8 5H5a3 3 0 0 0 3 5" />
      <path d="M16 5h3a3 3 0 0 1-3 5" />
      <path d="M10 13h4v2a2 2 0 0 1-2 2h0a2 2 0 0 1-2-2v-2z" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  );
}

export function IconBot(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 8V5" />
      <circle cx="12" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="13" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9 17h6" />
    </svg>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 19a4.5 4.5 0 0 1 4.5-4.2" />
    </svg>
  );
}

export function IconDevice(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6" y="3" width="12" height="18" rx="2.5" />
      <path d="M10 18h4" />
    </svg>
  );
}

export function IconDoor(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
      <path d="M3 21h18" />
      <circle cx="14" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconShield(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
      <path d="M9.5 12.2l1.8 1.8 3.5-3.8" />
    </svg>
  );
}

export function IconSpark(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconGlobe(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </svg>
  );
}

export function IconLeaderboard(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 21V10h4v11M10 21V3h4v18M15 21v-7h4v7" />
    </svg>
  );
}

export function IconLogin(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
    </svg>
  );
}

export function IconUser(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 17l5-5-5-5" />
      <path d="M19 12H7" />
      <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

export function IconHome(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v9a1 1 0 0 0 1 1h4v-5h2v5h4a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}
