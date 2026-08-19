import { redirect } from "next/navigation";
// /admin → /admin/dashboard (inside the protected route group)
export default function AdminRoot() {
  redirect("/admin/dashboard");
}

