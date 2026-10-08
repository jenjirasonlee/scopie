import {
  BarChart3,
  Calendar,
  CheckSquare,
  FileText,
  Gauge,
  LayoutGrid,
  type LucideIcon,
  Settings,
  Sparkles,
  Target,
  Timer,
  Trophy,
  Users,
} from 'lucide-react';

export type NavStatus = 'available' | 'planned';

export type NavItem = {
  key: string;
  label: string;
  segment: string;
  icon: LucideIcon;
  status: NavStatus;
  /** Roadmap phase that delivers the module (docs/ROADMAP.md). */
  phase?: number;
  summary: string;
  planned?: string[];
};

export const NAV_ITEMS: NavItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    segment: 'dashboard',
    icon: Gauge,
    status: 'available',
    summary: 'Organization overview.',
  },
  {
    key: 'analytics',
    label: 'Analytics',
    segment: 'analytics',
    icon: BarChart3,
    status: 'planned',
    phase: 3,
    summary: 'Post performance explorer and side-by-side comparisons.',
    planned: [
      'Filter posts by country, platform, format, pillar and campaign',
      'Median and mean performance with top examples',
      'Compare countries, accounts, platforms, formats and campaigns',
      'Only comparable metrics are compared, with definitions on every number',
    ],
  },
  {
    key: 'accounts',
    label: 'Accounts',
    segment: 'accounts',
    icon: Users,
    status: 'available',
    summary: 'Social accounts by country and platform.',
  },
  {
    key: 'content',
    label: 'Content',
    segment: 'content',
    icon: LayoutGrid,
    status: 'available',
    phase: 5,
    summary: 'Content hub for ideas, drafts and published content.',
    planned: [
      'Content items with caption, platform, country, pillar, format and campaign',
      'Version history that never overwrites earlier drafts',
      'Creative asset uploads',
    ],
  },
  {
    key: 'calendar',
    label: 'Calendar',
    segment: 'calendar',
    icon: Calendar,
    status: 'available',
    phase: 5,
    summary: 'Month, week and list views of planned and published content.',
    planned: [
      'Filter by country, platform, owner, status, pillar and campaign',
      'Open any item from the calendar',
    ],
  },
  {
    key: 'approvals',
    label: 'Approvals',
    segment: 'approvals',
    icon: CheckSquare,
    status: 'available',
    phase: 6,
    summary: 'Content waiting for review, sent back for changes, or approved.',
    planned: [
      'Submit content for review',
      'Comment, mention, request changes, approve or reject',
      'Full approval history per version',
    ],
  },
  {
    key: 'strategy',
    label: 'Strategy',
    segment: 'strategy',
    icon: Target,
    status: 'available',
    phase: 7,
    summary: 'Strategies per market with objectives, pillars and KPIs.',
    planned: [
      'Objectives and KPIs per country or region',
      'Content pillar targets and coverage',
      'Link content to objectives',
    ],
  },
  {
    key: 'benchmarks',
    label: 'Benchmarks',
    segment: 'benchmarks',
    icon: Trophy,
    status: 'available',
    phase: 4,
    summary: 'Benchmark groups and rankings on clearly named metrics.',
    planned: [
      'Rank countries, accounts and competitors',
      'Every ranking states the metric and period it is based on',
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    segment: 'reports',
    icon: FileText,
    status: 'planned',
    phase: 9,
    summary: 'Weekly social intelligence reports.',
    planned: [
      'Automatic weekly report every Monday',
      'Top markets, top content, insights, opportunities and risks',
    ],
  },
  {
    key: 'insights',
    label: 'AI Insights',
    segment: 'insights',
    icon: Sparkles,
    status: 'planned',
    phase: 8,
    summary: 'Evidence-backed insights and recommendations from your own data.',
    planned: [
      'Detect meaningful changes, anomalies and trends',
      'Recommendations that cite the data they are based on',
      'Turn a recommendation into a content idea',
    ],
  },
  {
    key: 'productivity',
    label: 'Productivity',
    segment: 'productivity',
    icon: Timer,
    status: 'planned',
    phase: 11,
    summary: 'Team workflow insights from Scopie data only. No employee surveillance.',
    planned: ['Approval cycles and time in review', 'Publishing consistency and strategy coverage'],
  },
  {
    key: 'settings',
    label: 'Settings',
    segment: 'settings',
    icon: Settings,
    status: 'available',
    summary: 'Profile, organization and members.',
  },
];

export function navItem(key: string): NavItem {
  const item = NAV_ITEMS.find((candidate) => candidate.key === key);
  if (!item) throw new Error(`Unknown navigation item: ${key}`);
  return item;
}
