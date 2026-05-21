"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/select";
import { type AppUser } from "@/lib/types";

const STORAGE_KEY = "tracker-current-user-id";

export function useCurrentUser(users: AppUser[], fallback: AppUser) {
  const [currentUser, setCurrentUser] = useState<AppUser>(fallback);

  useEffect(() => {
    const storedId = window.localStorage.getItem(STORAGE_KEY);
    const matched = users.find((user) => user.id === storedId);
    setCurrentUser(matched ?? fallback);
  }, [fallback, users]);

  function selectUser(userId: string) {
    const nextUser = users.find((user) => user.id === userId) ?? fallback;
    setCurrentUser(nextUser);
    window.localStorage.setItem(STORAGE_KEY, nextUser.id);
  }

  return { currentUser, selectUser };
}

export function CurrentUserSelect({
  users,
  currentUser,
  onChange,
}: {
  users: AppUser[];
  currentUser: AppUser;
  onChange: (userId: string) => void;
}) {
  if (users.length === 0) return null;

  return (
    <label className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <span className="text-sm font-medium text-navy-950">Posting as</span>
      <Select className="sm:min-w-[14rem]" value={currentUser.id} onChange={(event) => onChange(event.target.value)}>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
