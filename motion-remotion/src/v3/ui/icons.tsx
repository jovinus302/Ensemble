// v3 §6 icons: re-export the flat-mockup's Material-Symbols-Rounded-style
// inline SVG set (Apache 2.0 lineage, hand-authored strokes) and add the few
// v3 needs it doesn't cover yet (search, bolt, forum, info, description,
// auto_awesome, arrow_upward).
import React from 'react';
import type {IconProps} from '../../ui/icons';

export {
  CheckCircleIcon,
  ClockIcon as ScheduleIcon,
  HandIcon as FrontHandIcon,
  TagIcon,
  LockIcon,
  AddIcon,
  DocCheckIcon as FactCheckIcon,
  HourglassIcon as ProgressActivityIcon,
} from '../../ui/icons';

const base = (size: number): React.CSSProperties => ({display: 'block', flexShrink: 0});

export const SearchIcon: React.FC<IconProps> = ({size = 16, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <circle cx="10.5" cy="10.5" r="6" stroke={color} strokeWidth="1.8" />
    <path d="M15.2 15.2L20 20" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const BoltIcon: React.FC<IconProps> = ({size = 16, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M13 3.5L6.5 13h4.2L10 20.5 17.5 11h-4.2L13 3.5z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" fill={color} />
  </svg>
);

export const ForumIcon: React.FC<IconProps> = ({size = 18, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M4.5 6.5h11v7h-6l-3.2 2.6V13.5H4.5v-7z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M8.5 4h11v7h-1.5" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

export const InfoIcon: React.FC<IconProps> = ({size = 18, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" />
    <circle cx="12" cy="8" r="1" fill={color} />
    <path d="M12 11v6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const DescriptionIcon: React.FC<IconProps> = ({size = 16, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M8.5 12h7M8.5 15.5h7M8.5 8.5h3" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const AutoAwesomeIcon: React.FC<IconProps> = ({size = 16, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M12 4l1.4 4.6L18 10l-4.6 1.4L12 16l-1.4-4.6L6 10l4.6-1.4L12 4z" fill={color} />
    <path d="M19 15l.6 2 2 .6-2 .6-.6 2-.6-2-2-.6 2-.6.6-2z" fill={color} />
  </svg>
);

export const ArrowUpwardIcon: React.FC<IconProps> = ({size = 18, color = 'currentColor', style}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{...base(size), ...style}}>
    <path d="M12 19V6.5M6.5 11.5L12 6l5.5 5.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
