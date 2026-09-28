import React from 'react';

export interface IconProps {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}

const base = (size: number): React.CSSProperties => ({display: 'block', flexShrink: 0});

// Minimal hand-drawn Material-Symbols-Rounded-like icon set. Single color via
// currentColor / `color` prop. Rounded stroke caps/joins throughout.

export const CheckCircleIcon: React.FC<IconProps> = ({size = 20, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" />
    <path d="M8 12.3l2.6 2.6L16 9.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ClockIcon: React.FC<IconProps> = ({size = 16, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" />
    <path d="M12 7v5.3l3.6 2.1" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const HandIcon: React.FC<IconProps> = ({size = 16, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path
      d="M9 12.2V6.4a1.3 1.3 0 0 1 2.6 0v4.4M11.6 10.6V5a1.3 1.3 0 0 1 2.6 0v5.6M14.2 10.8V6.6a1.3 1.3 0 0 1 2.6 0v7.6c0 3-2.1 5.3-5.3 5.3h-1.2c-1.9 0-3-.6-4-1.9l-2.6-3.5c-.5-.7-.3-1.5.4-1.9.6-.4 1.4-.2 1.9.4l1.4 1.7"
      stroke={color}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ErrorTriangleIcon: React.FC<IconProps> = ({size = 16, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M12 4.5l8.5 14.7H3.5L12 4.5z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M12 10.5v4.2" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="12" cy="17.2" r="0.9" fill={color} />
  </svg>
);

export const TagIcon: React.FC<IconProps> = ({size = 16, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M4 4h7.5L20 12.5 12.5 20 4 11.5V4z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
    <circle cx="8.4" cy="8.4" r="1.3" stroke={color} strokeWidth="1.5" />
  </svg>
);

export const LockIcon: React.FC<IconProps> = ({size = 16, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <rect x="5.5" y="11" width="13" height="9" rx="2" stroke={color} strokeWidth="1.7" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

export const ArrowForwardIcon: React.FC<IconProps> = ({size = 18, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M4.5 12h14.5M13 6.5l6 5.5-6 5.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const SendIcon: React.FC<IconProps> = ({size = 18, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M12 19V6.5M6.5 11.5L12 6l5.5 5.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const AddIcon: React.FC<IconProps> = ({size = 18, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M12 5.5v13M5.5 12h13" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const AtSignIcon: React.FC<IconProps> = ({size = 16, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.7" />
    <circle cx="12" cy="12" r="3.4" stroke={color} strokeWidth="1.6" />
    <path d="M15.4 12v1.6c0 1.1.9 1.7 1.9 1.4 1.3-.4 2.2-1.9 2.2-3.6 0-3-2.2-5.4-5.9-5.4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const DocCheckIcon: React.FC<IconProps> = ({size = 20, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M14 3.5V8h4" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M9 14.2l2 2 4-4.4" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const SwapHorizIcon: React.FC<IconProps> = ({size = 18, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M4.5 9h13M14 5.5L17.5 9 14 12.5" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M19.5 15h-13M10 11.5L6.5 15 10 18.5" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const PersonReportIcon: React.FC<IconProps> = ({size = 14, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <circle cx="12" cy="7.5" r="3" stroke={color} strokeWidth="1.6" />
    <path d="M6 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const HourglassIcon: React.FC<IconProps> = ({size = 16, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M7 4.5h10M7 19.5h10" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    <path d="M8 4.5v2.4c0 1.6.9 3 3.3 4.1.1.05.1.15 0 .2C8.9 12.3 8 13.7 8 15.3v2.2M16 4.5v2.4c0 1.6-.9 3-3.3 4.1-.1.05-.1.15 0 .2 2.4.7 3.3 2.1 3.3 3.7v2.2" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

export const AttachIcon: React.FC<IconProps> = ({size = 18, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M16.5 7.5l-6.9 6.9a3 3 0 0 0 4.2 4.2l7.2-7.2a5 5 0 0 0-7.1-7.1L6.7 10.5a7 7 0 0 0 9.9 9.9" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const HomeIcon: React.FC<IconProps> = ({size = 22, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M4.5 11.5L12 5l7.5 6.5" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6.5 10v8.5A1 1 0 0 0 7.5 19.5H16.5A1 1 0 0 0 17.5 18.5V10" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
  </svg>
);

export const ActivityIcon: React.FC<IconProps> = ({size = 22, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M4 12.5h3.4l2-5.5 3.2 11 2-5.5H20" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
