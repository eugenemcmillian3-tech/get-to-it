import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { cardClass, chipClass } from "@/lib/styles";

export const metadata: Metadata = { title: "Shared project brief — GET TO IT", robots: { index: false, follow: false } };

type SharedPreview = {
  ok?: boolean;
  name?: string;
  purpose?: string;
  version?: number;
  expires_at?: string;
  spec?: {
    purpose?: string;
    pages?: { path: string; title: string }[];
    features?: string[];
    auth?: boolean;
  } | null;
};

export default async function SharedPreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const settings = getSupabaseSettings();
  if (!settings || !token || token.length < 20) notFound();

  const client = createClient(settings.url, settings.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await client.rpc("get_shared_app_preview", { p_token_hash: tokenHash });
  const preview = (data ?? {}) as SharedPreview;
  if (error || preview.ok !== true) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Shared read-only brief</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight">{preview.name ?? "A project"}</h1>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className={chipClass}>Expires {preview.expires_at?.slice(0, 16).replace("T", " ") ?? "soon"}</span>
        <span className={chipClass}>Version {preview.version ?? "current"}</span>
        <span className={chipClass}>No files, comments or secrets</span>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted">{preview.purpose}</p>

      <section className={`${cardClass} mt-6`}>
        <h2 className="text-lg font-bold">Approved direction</h2>
        {preview.spec ? (
          <>
            <p className="mt-2 text-sm text-muted">{preview.spec.purpose}</p>
            <h3 className="mt-4 text-sm font-bold">Routes</h3>
            <ul className="mt-1 space-y-1 text-sm text-muted">
              {(preview.spec.pages ?? []).map((page) => <li key={page.path}><code className="text-xs">{page.path}</code> {page.title}</li>)}
            </ul>
            <h3 className="mt-4 text-sm font-bold">Features</h3>
            <ul className="mt-1 space-y-1 text-sm text-muted">
              {(preview.spec.features ?? []).map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
          </>
        ) : <p className="mt-2 text-sm text-muted">No approved specification is available.</p>}
      </section>
      <p className="mt-6 text-xs leading-relaxed text-muted">
        This expiring link was explicitly granted by a project maintainer. It does not expose source files,
        review comments, environment values, provider credentials or live preview access.
      </p>
    </main>
  );
}
