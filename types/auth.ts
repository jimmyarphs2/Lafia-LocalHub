export const USER_ROLES = ["customer", "merchant", "super_admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface AuthActor {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  businessId: string | null;
  isDemo: boolean;
}

export interface AuthRoleClaim {
  sub: string;
  role: UserRole;
  businessId?: string | null;
}
