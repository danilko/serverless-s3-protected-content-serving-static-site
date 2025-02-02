import React, { createContext, useContext, useState } from "react";

// Define the possible notification types
export type NotificationType = "success" | "error" | "info";

// Shape of the context data
type NotificationContextType = {
  message: string | null;
  notificationType: NotificationType | null;
  showNotification: (message: string, type?: NotificationType) => void;
  clearNotification: () => void;
};

// Create the context
const NotificationContext = createContext<NotificationContextType>({
  message: null,
  notificationType: null,
  showNotification: () => {},
  clearNotification: () => {},
});

// Hook to access our context
export const useNotification = () => useContext(NotificationContext);

// Provider
export const NotificationProvider: React.FC<React.PropsWithChildren<unknown>> = ({
                                                                                   children,
                                                                                 }) => {
  const [message, setMessage] = useState<string | null>(null);
  const [notificationType, setNotificationType] =
    useState<NotificationType | null>(null);

  // showNotification: sets the message and optional type (default "info")
  const showNotification = (message: string, type: NotificationType = "info") => {
    setMessage(message);
    setNotificationType(type);
  };

  // clearNotification: clears both the message and its type
  const clearNotification = () => {
    setMessage(null);
    setNotificationType(null);
  };

  return (
    <NotificationContext.Provider
      value={{ message, notificationType, showNotification, clearNotification }}
    >
      {children}
    </NotificationContext.Provider>
  );
};
