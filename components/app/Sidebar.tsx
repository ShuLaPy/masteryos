"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  Brain,
  LayoutDashboard,
  Cpu,
  Code2,
  FlaskConical,
  BarChart3,
  CalendarCheck,
  CalendarClock,
  LogOut,
  Flame,
  BookOpen,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const navItems = [
  {
    label: "Mentor",
    href: "/",
    icon: LayoutDashboard,
    description: "AI daily guidance",
  },
  {
    label: "AIML Track",
    href: "/aiml",
    icon: Cpu,
    description: "Concepts & theory",
  },
  {
    label: "DSA Track",
    href: "/dsa",
    icon: Code2,
    description: "Problems & patterns",
  },
  {
    label: "Daily Review",
    href: "/review",
    icon: BookOpen,
    description: "Spaced repetition",
    badgeKey: "due",
  },
  {
    label: "Feynman",
    href: "/feynman",
    icon: FlaskConical,
    description: "Teach to master",
  },
  {
    label: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    description: "Progress & insights",
  },
  {
    label: "Schedule",
    href: "/schedule",
    icon: CalendarClock,
    description: "Lectures & runway",
  },
  {
    label: "Weekly Review",
    href: "/weekly-review",
    icon: CalendarCheck,
    description: "Sunday ritual",
  },
];

interface SidebarProps {
  dueCount?: number;
  streakCount?: number;
  userEmail?: string;
  displayName?: string;
}

export default function Sidebar({
  dueCount = 0,
  streakCount = 0,
  userEmail,
  displayName,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    toast.success("Signed out");
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-64 shrink-0 h-screen sticky top-0 flex flex-col border-r border-border/60 bg-sidebar">
      {/* Logo */}
      <div className="p-6 border-b border-border/40">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center glow-violet">
            <Brain className="w-4.5 h-4.5 text-primary" />
          </div>
          <div>
            <span className="text-base font-bold gradient-text block leading-none">
              MasteryOS
            </span>
            <span className="text-[10px] text-muted-foreground mt-0.5 block">
              Learning OS
            </span>
          </div>
        </Link>
      </div>

      {/* Streak Banner */}
      {streakCount > 0 && (
        <div className="mx-3 mt-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <Flame className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-medium text-amber-300">
              {streakCount} day streak
            </span>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto mt-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          const showBadge = item.badgeKey === "due" && dueCount > 0;

          return (
            <Link key={item.href} href={item.href}>
              <motion.div
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
                className={cn(
                  "relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group",
                  isActive
                    ? "bg-primary/15 text-primary border border-primary/20"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeNav"
                    className="absolute inset-0 rounded-lg bg-primary/10"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                  />
                )}
                <Icon
                  className={cn(
                    "w-4 h-4 shrink-0 relative z-10",
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
                <div className="flex-1 relative z-10">
                  <div className="text-sm font-medium leading-none">{item.label}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {item.description}
                  </div>
                </div>
                {showBadge && (
                  <Badge className="relative z-10 bg-primary/20 text-primary border-primary/30 text-[10px] h-4 px-1.5">
                    {dueCount}
                  </Badge>
                )}
                {isActive && (
                  <ChevronRight className="w-3 h-3 text-primary relative z-10" />
                )}
              </motion.div>
            </Link>
          );
        })}
      </nav>

      {/* User & Logout */}
      <div className="p-3 border-t border-border/40">
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg mb-1">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
            {(displayName ?? userEmail ?? "U")[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {displayName ?? "Learner"}
            </p>
            <p className="text-[10px] text-muted-foreground truncate">
              {userEmail}
            </p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-destructive transition-colors text-sm"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
