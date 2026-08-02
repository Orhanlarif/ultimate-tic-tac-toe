import { requireAdminPage } from "@/lib/admin";
import { AdminUsersList } from "@/components/admin/AdminUsersList";

export default async function AdminPage() {
  await requireAdminPage();
  return <AdminUsersList />;
}
