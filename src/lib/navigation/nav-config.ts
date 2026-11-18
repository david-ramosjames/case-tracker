import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BriefcaseBusiness,
  CircleDollarSign,
  ClipboardList,
  Download,
  HelpCircle,
  LayoutDashboard,
  MessageCircleWarning,
  MessageSquare,
  Phone,
  Presentation,
  Scale,
  Settings,
  Sparkles,
  Target,
} from "lucide-react";
import { isAdminRole } from "@/lib/auth/access";
import {
  canViewCaseCsvExport,
  canViewOutputAndGoals,
  canViewPerformance,
} from "@/lib/auth/constants";
import { type SessionUser } from "@/lib/auth/types";

export type NavBadgeKey = "suggestions" | "contact" | "needsResponse";

export type NavBadges = Partial<Record<NavBadgeKey, number>>;

export type NavItemDef = {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: NavBadgeKey;
  adminOnly?: boolean;
  attorneyGoalsOnly?: boolean;
  performanceOnly?: boolean;
  caseExportOnly?: boolean;
};

export type NavGroupDef = {
  id: string;
  label: string;
  items: NavItemDef[];
};

/** Logical groups for the persistent sidebar (permissions applied at filter time). */
export const NAV_GROUPS: NavGroupDef[] = [
  {
    id: "overview",
    label: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    id: "cases",
    label: "Cases",
    items: [
      { href: "/cases", label: "Cases", icon: BriefcaseBusiness },
      { href: "/stage-suggestions", label: "Suggestions", icon: Sparkles, badgeKey: "suggestions" },
      { href: "/results", label: "Results", icon: CircleDollarSign },
      { href: "/litigation", label: "Litigation", icon: Scale },
    ],
  },
  {
    id: "client",
    label: "Client",
    items: [
      { href: "/client-contact", label: "Contact", icon: Phone, badgeKey: "contact" },
      {
        href: "/needs-response",
        label: "Needs response",
        icon: MessageCircleWarning,
        badgeKey: "needsResponse",
      },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    items: [
      {
        href: "/performance",
        label: "Performance",
        icon: ClipboardList,
        performanceOnly: true,
      },
    ],
  },
  {
    id: "attorney",
    label: "Attorney",
    items: [
      { href: "/output", label: "Output", icon: BarChart3, attorneyGoalsOnly: true },
      { href: "/jumbotron", label: "Jumbotron", icon: Presentation, attorneyGoalsOnly: true },
      { href: "/goals", label: "Goals", icon: Target, attorneyGoalsOnly: true },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    items: [
      { href: "/export", label: "Export", icon: Download, caseExportOnly: true },
      { href: "/client-sms", label: "Client SMS", icon: MessageSquare, adminOnly: true },
      { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
      { href: "/faq", label: "FAQ", icon: HelpCircle, adminOnly: true },
    ],
  },
];

export function visibleNavGroups(sessionUser: SessionUser): NavGroupDef[] {
  const isAdmin = isAdminRole(sessionUser.role);
  const showGoals = canViewOutputAndGoals(sessionUser.role);
  const showPerformance = canViewPerformance(sessionUser.role);
  const showCaseExport = canViewCaseCsvExport(sessionUser.email);

  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.adminOnly && !isAdmin) return false;
      if (item.attorneyGoalsOnly && !showGoals) return false;
      if (item.performanceOnly && !showPerformance) return false;
      if (item.caseExportOnly && !showCaseExport) return false;
      return true;
    }),
  })).filter((group) => group.items.length > 0);
}

export function isNavItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
