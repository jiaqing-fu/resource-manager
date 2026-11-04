import { NotificationListPage } from "@/components/notifications/NotificationListPage";
import { getPublicNotificationMailConfig } from "@/server/services/notification-config";

export const dynamic = "force-dynamic";

export default function NotificationsPage() {
  return <NotificationListPage config={getPublicNotificationMailConfig()} />;
}
