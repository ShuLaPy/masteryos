"use client";

import MorningCheckInModal, { type CheckInProps } from "@/components/app/MorningCheckInModal";

interface DashboardShellProps {
  checkIn: CheckInProps & { shouldShow: boolean };
  children: React.ReactNode;
}

export default function DashboardShell({ checkIn, children }: DashboardShellProps) {
  return (
    <>
      <MorningCheckInModal {...checkIn} />
      {children}
    </>
  );
}
