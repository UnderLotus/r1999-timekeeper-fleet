export function PsychubeAmplificationBadge({
  value,
}: {
  value: number;
}): React.JSX.Element | null {
  return value > 1 ? <span className="psy-card__imprint">{value}</span> : null;
}
