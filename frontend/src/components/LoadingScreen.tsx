export function LoadingScreen(props: { label: string; compact?: boolean }) {
  return (
    <div className={props.compact ? "loading compact" : "loading"}>
      <div className="spinner" />
      <p>{props.label}</p>
    </div>
  );
}
