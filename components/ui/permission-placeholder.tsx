import { card } from "@/lib/ui-styles";

export function PermissionPlaceholder({ title }: { title: string }) {
  return (
    <div className={`${card} flex items-center justify-center py-8 opacity-50`}>
      <div className="text-center">
        <p className="text-sm font-semibold text-muted-foreground">🔒 {title}</p>
        <p className="mt-1 text-xs text-muted-foreground">Access denied. Contact your administrator if you require access.</p>
      </div>
    </div>
  );
}
