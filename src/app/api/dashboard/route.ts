import { success } from "@/lib/api-response";
import { loadDashboardData } from "@/lib/dashboard-data";

export async function GET() {
  return success(loadDashboardData());
}
