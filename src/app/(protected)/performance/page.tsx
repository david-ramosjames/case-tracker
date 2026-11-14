import { redirect } from "next/navigation";
import { defaultPerformancePath } from "@/lib/performance/access";
import { requireSessionUser } from "@/lib/auth/session";

export default async function PerformanceIndexPage() {
  const sessionUser = await requireSessionUser();
  redirect(defaultPerformancePath(sessionUser.role));
}
