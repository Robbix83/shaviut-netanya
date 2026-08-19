import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const devBypass = process.env.NODE_ENV !== "production" && process.env.ADMIN_DEV_BYPASS === "true";
  const session = devBypass ? { user: { email: "dev@local" } } : await auth();
  if (!session) redirect("/admin/login");

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🏠</span>
          <span className="font-bold text-slate-800">שאיוות נתניה</span>
          <span className="text-slate-300 mx-2">|</span>
          <span className="text-sm text-slate-500">Admin Dashboard</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400">{session.user?.email}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/admin/login" });
            }}
          >
            <button type="submit" className="text-xs text-slate-500 hover:text-slate-800 underline">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="p-6 max-w-6xl mx-auto">{children}</main>
    </div>
  );
}
