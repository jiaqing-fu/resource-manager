import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, getUserFromToken } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { SearchParamsKey } from "@/components/SearchParamsKey";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const user = await getUserFromToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <Suspense fallback={null}>
        <SearchParamsKey>{children}</SearchParamsKey>
      </Suspense>
    </AppShell>
  );
}
