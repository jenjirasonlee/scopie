import type { Metadata } from 'next';
import { ComingSoon } from '@/components/shared/coming-soon';

export const metadata: Metadata = { title: 'Reports' };

export default function Page() {
  return <ComingSoon moduleKey="reports" />;
}
