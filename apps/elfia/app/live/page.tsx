import type { Metadata } from "next";

import { Editable } from "@azone/cms";
import { Button, ButtonGroup, PageShell } from "@azone/ui";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { BRAND, whatsappUrl } from "@/constants/brand";
import { DROP_STEPS, LIVE_SESSIONS } from "@/constants/catalogue";

export const metadata: Metadata = {
  title: "Live drops",
  description:
    "ELFIA live drop schedule — when we go live, what is launching, and how buying during a session works.",
};

export default function LivePage() {
  const hasSessions = LIVE_SESSIONS.length > 0;

  return (
    <>
      <Navbar />
      <PageShell
        eyebrow="Live"
        title="Next drops"
        intro="Pieces are launched, styled, and priced during our live sessions. Follow us so the next one lands in your feed."
      >
        <section>
          <h2>Schedule</h2>
          {hasSessions ? (
            <ul className="mt-6 space-y-4">
              {LIVE_SESSIONS.map((session) => (
                <li
                  key={`${session.date}-${session.title}`}
                  className="border-border flex flex-col gap-3 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-gold-deep text-xs tracking-[0.28em] uppercase">
                      {session.platform}
                    </p>
                    <h3 className="mt-1.5 text-base font-semibold">
                      {session.title}
                    </h3>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {session.description}
                    </p>
                  </div>
                  <div className="sm:text-right">
                    <p className="text-sm font-medium">
                      <time dateTime={session.date}>
                        {new Date(session.date).toLocaleDateString("en-MY", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </time>
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {session.time}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            /*
              No invented dates. Editors publish the schedule from the CMS
              (Admin → Content, key `live.next`) and this line updates itself.
            */
            <p className="mt-3">
              <Editable
                k="live.next"
                fallback="The next drop has not been announced yet. Follow us on TikTok or join the WhatsApp alerts and you will know the moment it is scheduled."
              />
            </p>
          )}

          <div className="mt-8">
            <ButtonGroup>
              <Button href={BRAND.socials.tiktok} external>
                Follow for drop alerts
              </Button>
              <Button
                href={whatsappUrl("Hi ELFIA, please add me to the drop alerts.")}
                external
                variant="outline"
              >
                Get alerts on WhatsApp
              </Button>
            </ButtonGroup>
          </div>
        </section>

        <section>
          <h2>How a drop works</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {DROP_STEPS.map((item) => (
              <li key={item.step} className="border-border rounded-xl border p-5">
                <span className="text-gold-deep text-xs font-semibold tracking-[0.3em]">
                  {item.step}
                </span>
                <h3 className="mt-3 text-base font-semibold">{item.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {item.description}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </PageShell>
      <Footer />
    </>
  );
}
