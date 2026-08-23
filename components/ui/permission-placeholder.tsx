import { card } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

export function PermissionPlaceholder({ title }: { title: string }) {
  // v1.40.0 (AUDIT F8): the one hard-coded English sentence on otherwise
  // bilingual tabs.
  const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
  return (
    <div className={`${card} flex items-center justify-center py-8 opacity-50`}>
      <div className="text-center">
        <p className="text-sm font-semibold text-muted-foreground">🔒 {title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{L("Access denied. Contact your administrator if you require access.", "Akses dinafikan. Hubungi pentadbir anda jika anda memerlukan akses.")}</p>
      </div>
    </div>
  );
}
