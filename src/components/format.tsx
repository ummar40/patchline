const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const clock = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const integer = new Intl.NumberFormat("en-US");

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return `${milliseconds} ms`;
  }
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatCount(value: number): string {
  return integer.format(value);
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

// Times are rendered on the server, which does not know the viewer's zone, so they are
// shown in UTC and labelled as such.
export function Timestamp(props: { value: Date; precision?: "minute" | "second" }) {
  const text =
    props.precision === "second"
      ? `${clock.format(props.value)} UTC`
      : `${dateTime.format(props.value)} UTC`;
  return <time dateTime={props.value.toISOString()}>{text}</time>;
}
