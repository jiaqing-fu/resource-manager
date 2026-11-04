import { NotificationEditor } from "@/components/notifications/NotificationEditor";
import { getPublicNotificationMailConfig } from "@/server/services/notification-config";

export const dynamic = "force-dynamic";

export default function NewNotificationPage() {
  return <NotificationEditor notification={null} config={getPublicNotificationMailConfig()} />;
}
