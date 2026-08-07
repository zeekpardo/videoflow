import Link from "next/link";
import { appConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

export function AppLogo({ className, href = "/record" }: { className?: string; href?: string }) {
  const [first, ...rest] = appConfig.name.split(/(?=[A-Z][a-z])/);
  return (
    <Link href={href} className={cn("flex items-center gap-3", className)} aria-label={`${appConfig.name} home`}>
      <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-[14px] bg-primary shadow-[0_10px_24px_color-mix(in_srgb,var(--primary)_24%,transparent)]">
        {/* Buyer-provided logos may live on any HTTPS host, so this intentionally
            avoids Next Image's build-time remote-host allowlist. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={appConfig.logoUrl} alt="" width={44} height={44} className="h-full w-full object-cover" />
      </span>
      <span className="text-[21px] font-bold tracking-[-0.04em] text-slate-950">
        {first}<span className="text-primary">{rest.join("")}</span>
      </span>
    </Link>
  );
}
