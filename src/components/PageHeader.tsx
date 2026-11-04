"use client";

export function PageHeader({
  title,
  description,
  extra,
}: {
  title: string;
  description?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div className="rm-page-title-row">
      <div>
        <h1 className="rm-page-title">{title}</h1>
        {description ? <div className="rm-page-desc">{description}</div> : null}
      </div>
      {extra ? <div>{extra}</div> : null}
    </div>
  );
}
