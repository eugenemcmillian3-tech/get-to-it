import Link from "next/link";
import type { ReactNode } from "react";
import { focusRing } from "@/lib/styles";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <Link
        href="/"
        className={`w-fit text-sm font-black uppercase tracking-[0.25em] ${focusRing}`}
      >
        GET TO IT
      </Link>
      <h1 className="mt-8 text-3xl font-black tracking-tight">{title}</h1>
      <p className="mt-2 leading-relaxed text-muted">{subtitle}</p>
      <div className="mt-6">{children}</div>
      <div className="mt-6 text-sm text-muted">{footer}</div>
    </div>
  );
}
