import { type UserRole } from "@/lib/types";

/** Roles that can appear on shared `contacts.roles` checkboxes. */
export const CONTACT_CAPABILITY_ROLES = [
  "attorney",
  "paralegal",
  "legal_assistant",
  "manager",
] as const;

export type ContactCapabilityRole = (typeof CONTACT_CAPABILITY_ROLES)[number];

export type ContactRoleFields = {
  role?: string | null;
  roles?: string[] | null;
};

export function normalizeContactRoles(
  roles: string[] | null | undefined,
  primary: string | null | undefined,
): { role: string | null; roles: string[] } {
  const cleaned = [
    ...new Set(
      (roles ?? [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ];
  const primaryRole = primary?.trim() || null;
  if (cleaned.length === 0 && primaryRole) {
    return { role: primaryRole, roles: [primaryRole] };
  }
  if (!primaryRole && cleaned.length > 0) {
    return { role: cleaned[0] ?? null, roles: cleaned };
  }
  if (primaryRole && !cleaned.includes(primaryRole)) {
    return { role: primaryRole, roles: [primaryRole, ...cleaned] };
  }
  return { role: primaryRole, roles: cleaned };
}

export function contactRoleList(contact: ContactRoleFields): string[] {
  return normalizeContactRoles(contact.roles, contact.role).roles;
}

export function hasContactRole(contact: ContactRoleFields, want: string | null | undefined): boolean {
  if (!want) return false;
  return contactRoleList(contact).includes(want);
}

export function isContactCapabilityRole(value: string | null | undefined): value is ContactCapabilityRole {
  return CONTACT_CAPABILITY_ROLES.includes(value as ContactCapabilityRole);
}

/** AppUser.roles as UserRole[], always including primary. */
export function appUserRolesFromContact(contact: ContactRoleFields): UserRole[] {
  const { role, roles } = normalizeContactRoles(contact.roles, contact.role);
  const out: UserRole[] = [];
  for (const value of roles.length ? roles : role ? [role] : []) {
    if (
      value === "attorney" ||
      value === "paralegal" ||
      value === "paralegal_manager" ||
      value === "legal_assistant" ||
      value === "manager" ||
      value === "admin" ||
      value === "super_admin"
    ) {
      out.push(value);
    }
  }
  return out;
}

export function withToggledContactRole(
  contact: ContactRoleFields,
  role: ContactCapabilityRole,
  enabled: boolean,
): { role: string; roles: string[] } {
  const current = new Set(contactRoleList(contact));
  if (enabled) current.add(role);
  else current.delete(role);

  let roles = [...current];
  if (roles.length === 0) {
    roles = [contact.role?.trim() || role];
  }

  let primary = contact.role?.trim() || roles[0]!;
  if (!roles.includes(primary)) {
    primary = roles[0]!;
  }

  // Prefer keeping a non-manager staff primary when toggling capabilities.
  if (!enabled && primary === role) {
    primary = roles.find((value) => value !== "manager") ?? roles[0]!;
  }

  return { role: primary, roles };
}
