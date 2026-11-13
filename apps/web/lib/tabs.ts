// The left panel's tabs, in order. This one list drives the sidebar, the page guard and the Tabs
// checklist on the Users form: add a tab here and it shows in all three. `key` is the permission
// stored in employee_permissions (the two CRM keys are older than this list, hence their names).
import type { UserRole } from "@callflow/shared-types";
import { CRM_ENABLED } from "@/lib/crm";

export type Tab = {
  key: string; label: string; section: string; icon: string;
  /** Where the sidebar link goes. */
  path: string;
  /** Every page under this prefix belongs to the tab (defaults to `path`). */
  match?: string;
  exact?: boolean;
};

const ALL: (Tab & { crm?: boolean })[] = [
  { key: "crm_leads",    label: "Leads",        section: "CRM",        icon: "☰", path: "/dashboard/crm", exact: true, crm: true },
  { key: "crm_settings", label: "CRM Settings", section: "CRM",        icon: "⚙", path: "/dashboard/crm/settings", crm: true },
  { key: "recordings",   label: "Recordings",   section: "Calls",      icon: "▷", path: "/dashboard/recordings" },
  // opens on the report itself; the email schedules are one click away (client, 12 Nov)
  { key: "reports",      label: "Reports",      section: "Analytics",  icon: "✉", path: "/dashboard/reports/view", match: "/dashboard/reports" },
  { key: "lines",        label: "Lines",        section: "Management", icon: "≡", path: "/dashboard/lines" },
  { key: "intercoms",    label: "Intercoms",    section: "Management", icon: "☎", path: "/dashboard/intercoms" },
  { key: "users",        label: "Users",        section: "Management", icon: "◯", path: "/dashboard/users" },
  { key: "teams",        label: "Teams",        section: "Management", icon: "◐", path: "/dashboard/teams" },
  { key: "payments",     label: "Payments",     section: "Salary",     icon: "◈", path: "/dashboard/students" },
];
export const TABS: Tab[] = ALL.filter((t) => !t.crm || CRM_ENABLED);

/** Ticked on the Users form like a tab, but it is a button on the Leads tab, not a page. */
export const EXTRA_PERMISSIONS = CRM_ENABLED ? [{ key: "export_leads", label: "Export leads" }] : [];

export const RANKS: { role: UserRole; label: string; hint: string }[] = [
  { role: "owner",    label: "Super Admin", hint: "Sees every tab and everyone's data" },
  { role: "admin",    label: "Admin",       hint: "Sees the ticked tabs, with everyone's data" },
  { role: "employee", label: "User",        hint: "Sees the ticked tabs, with only their own calls and report" },
];
export const rankLabel = (role: string) => RANKS.find((r) => r.role === role)?.label ?? role;

/** The tab a page belongs to (longest matching prefix), if any. */
export function tabOf(pathname: string): Tab | undefined {
  return TABS.filter((t) => (t.exact ? pathname === t.path : pathname.startsWith(t.match ?? t.path)))
    .sort((a, b) => (b.match ?? b.path).length - (a.match ?? a.path).length)[0];
}

/** A User's home: their details, targets, calls and earnings on one page (also their salary page). */
export const HOME = "/dashboard/me";
