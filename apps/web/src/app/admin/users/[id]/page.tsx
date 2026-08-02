import { requireAdminPage } from "@/lib/admin";
import { AdminUserDetail } from "@/components/admin/AdminUserDetail";

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage();
  const { id } = await params;
  return <AdminUserDetail userId={id} />;
}
