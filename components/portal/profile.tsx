"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { L } from "@/components/portal/page-shared";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { btnClass, card, inputClass } from "@/lib/ui-styles";
import { useEffect, useState } from "react";

/* ================= Profile ================= */

export function Profile() {
  const [profile, setProfile] = useState<Record<string, string | null>>({});
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { show: showToast, node: toastNode } = useSaveToast();
  /* v1.77.0 — skeleton until the first fetch lands: a "—" for every field
     while loading read as a blank profile. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<{ profile: Record<string, string | null> }>(`/staff/profile`).then(
      (r) => {
        if (r.data?.profile) {
          setProfile(r.data.profile);
          setPhone(r.data.profile.phone ?? "");
        }
        setLoaded(true);
      }
    );
  }, []);
  const save = async () => {
    if (phone === (profile.phone ?? "")) {
      showToast(
        L("No changes", "Tiada perubahan"),
        L("Phone number unchanged", "Nombor telefon tidak berubah"),
        "notice"
      );
      return;
    }
    setSaving(true);
    const res = await api(`/staff/profile`, {
      method: "PATCH",
      body: JSON.stringify({ phone }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setProfile((pr) => ({ ...pr, phone }));
      setTimeout(() => setSaved(false), 2000);
      showToast(
        L("Saved", "Disimpan"),
        L("Phone number updated", "Nombor telefon dikemas kini")
      );
    } else {
      alert(L("Failed to save phone number", "Gagal menyimpan nombor telefon"));
    }
  };
  return (
    <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
      <div className={card}>
        <p className="text-sm font-semibold">
          {L("My profile", "Profil saya")}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {[
            "name",
            "email",
            "role",
            "employee_id",
            "position",
            "department",
            "employment_status",
          ].map((k) => (
            <div key={k}>
              <dt className="text-muted-foreground text-[11px] capitalize">
                {getLang() === "ms"
                  ? ((
                      {
                        name: "nama",
                        email: "e-mel",
                        role: "peranan",
                        employee_id: "id pekerja",
                        position: "jawatan",
                        department: "jabatan",
                        employment_status: "status pekerjaan",
                      } as Record<string, string>
                    )[k] ?? k.replace("_", " "))
                  : k.replace("_", " ")}
              </dt>
              {loaded ? (
                <dd className="font-medium break-words">{profile[k] ?? "—"}</dd>
              ) : (
                <dd>
                  <Skel className="mt-0.5 h-4 w-3/4" />
                </dd>
              )}
            </div>
          ))}
        </dl>
        {toastNode}
        <label className="mt-4 block">
          <span className="text-muted-foreground mb-1 block text-xs">
            {L(
              "Phone (you can update this)",
              "Telefon (anda boleh kemas kini)"
            )}
          </span>
          {loaded ? (
            <input
              className={inputClass}
              placeholder="+60 12-345 6789"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          ) : (
            <Skel className="h-10 w-full" />
          )}
        </label>
        <button
          type="button"
          disabled={saving}
          className={`${btnClass} mt-3`}
          onClick={() => void save()}
        >
          {saving
            ? L("Saving...", "Menyimpan...")
            : saved
              ? L("Saved!", "Disimpan!")
              : L("Save", "Simpan")}
        </button>
      </div>

      <div className={card}>
        <p className="text-sm font-semibold">
          {L("Change password", "Tukar kata laluan")}
        </p>
        <p className="text-muted-foreground mt-1 mb-3 text-xs">
          {L(
            "Changing your password signs you out on every other device immediately. Google sign-in accounts manage their password with Google instead.",
            "Menukar kata laluan anda akan melog keluar semua peranti lain serta-merta. Akaun log masuk Google mengurus kata laluan mereka dengan Google."
          )}
        </p>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
