"use client";

import React from "react";
import App from "./App";
import {NotificationProvider} from "@/components/NotificationContext";
import NotificationBanner from "@/components/NotificationBannerComponent";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-blue-50 text-blue-900">
      <NotificationProvider>
    {/* Notification banner sits at the top of the app */}
      <NotificationBanner />


      <App />
    </NotificationProvider>


    </div>
  );
}
