import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, getUserFromToken } from "@/lib/auth";
import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const user = await getUserFromToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (user) redirect("/");
  return <LoginForm />;
}
