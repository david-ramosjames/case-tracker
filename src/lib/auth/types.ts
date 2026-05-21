import { type UserRole } from "@/lib/types";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole | null;
  avatarInitials: string;
};
