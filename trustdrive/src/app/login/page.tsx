import { LoginForm } from "@/components/LoginForm";

/** Where to go after signing in: only a path on this site, never another site (`//evil.example`). */
function safeNext(next: string | string[] | undefined) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return <LoginForm next={safeNext(next)} />;
}
