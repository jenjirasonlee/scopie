import { NativeSelect } from '@/components/ui/native-select';

const FALLBACK = [
  'UTC',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Rome',
];

function allTimezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  const zones = intl.supportedValuesOf?.('timeZone') ?? FALLBACK;
  return zones.includes('UTC') ? zones : ['UTC', ...zones];
}

export function TimezoneSelect({
  allowEmpty,
  ...props
}: React.ComponentProps<typeof NativeSelect> & { allowEmpty?: string }) {
  return (
    <NativeSelect {...props}>
      {allowEmpty ? <option value="">{allowEmpty}</option> : null}
      {allTimezones().map((zone) => (
        <option key={zone} value={zone}>
          {zone.replaceAll('_', ' ')}
        </option>
      ))}
    </NativeSelect>
  );
}
