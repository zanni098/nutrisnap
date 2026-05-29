"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, History, BarChart3, Settings, Camera } from "lucide-react";
import { useCapture } from "./CaptureProvider";

const items = [
  { href: "/", label: "Today", icon: Home },
  { href: "/history", label: "History", icon: History },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/settings", label: "Profile", icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();
  const { openCapture } = useCapture();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md">
      <div className="relative border-t border-border bg-surface/90 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
        <div className="grid grid-cols-5 items-center">
          {items.slice(0, 2).map((item) => (
            <NavLink key={item.href} {...item} active={pathname === item.href} />
          ))}

          <div className="flex justify-center">
            <button
              onClick={openCapture}
              aria-label="Snap a meal"
              className="-mt-8 flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-brand/40 ring-4 ring-background transition-transform active:scale-95"
            >
              <Camera className="h-7 w-7" strokeWidth={2.2} />
            </button>
          </div>

          {items.slice(2).map((item) => (
            <NavLink key={item.href} {...item} active={pathname === item.href} />
          ))}
        </div>
      </div>
    </nav>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof Home;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex flex-col items-center gap-0.5 py-1 text-[10px] font-medium transition-colors ${
        active ? "text-brand" : "text-muted hover:text-foreground"
      }`}
    >
      <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
      {label}
    </Link>
  );
}
