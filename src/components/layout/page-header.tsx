interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    // `flex-wrap` + `gap` : sans eux, une action (bouton, sélecteur) vient chevaucher le
    // titre dès que la largeur manque. La description est bornée en largeur : au-delà
    // d'une soixantaine de caractères par ligne, un paragraphe devient pénible à lire.
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-balance sm:text-2xl">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
