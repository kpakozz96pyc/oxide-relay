export function ErrorCard(props: { title: string; message: string }) {
  return (
    <section className="page">
      <div className="panel">
        <h1 className="page-title">{props.title}</h1>
        <div className="banner error">{props.message}</div>
      </div>
    </section>
  );
}
