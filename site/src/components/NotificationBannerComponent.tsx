import React from "react";
import { useNotification } from "./NotificationContext";
import type { NotificationType } from "./NotificationContext";

// Define style sets for each type
const TYPE_STYLES: Record<NotificationType, string> = {
  success: "bg-green-100 border-green-400 text-green-700",
  error: "bg-red-100 border-red-400 text-red-700",
  info: "bg-blue-100 border-blue-400 text-blue-700",
};

const NotificationBanner: React.FC = () => {
  const { message, notificationType, clearNotification } = useNotification();

  if (!message || !notificationType) return null;

  // Pick the right Tailwind classes based on type
  const styles = TYPE_STYLES[notificationType];

  return (
    <div
      className={`
        fixed top-0 left-1/2 transform -translate-x-1/2 
        border px-4 py-3 rounded w-11/12 md:w-1/2 shadow-lg
        ${styles}
      `}
      role="alert"
    >
      <div className="flex items-center justify-between">
        <span className="font-bold mr-2 capitalize">{notificationType}:</span>
        <span>{message}</span>
        <button
          onClick={clearNotification}
          className="
            ml-4
            hover:bg-opacity-25
            rounded p-1
          "
        >
          <svg className="w-5 h-5 fill-current" viewBox="0 0 20 20">
            <path d="M10 8.586L3.757 2.343 2.343 3.757 8.586 10l-6.243 6.243 1.414 1.414L10 11.414l6.243 6.243 1.414-1.414L11.414 10l6.243-6.243-1.414-1.414L10 8.586z" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default NotificationBanner;