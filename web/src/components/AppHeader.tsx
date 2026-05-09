"use client";

import Tabs from "@/components/Tabs";

type AppHeaderProps = {
  username?: string | null;
  onLogout: () => void;
};

export default function AppHeader({ username, onLogout }: AppHeaderProps) {
  return (
    <>
      <section className="topbar">
        <div>
          <p className="topbar-label">Signed in</p>
          <p className="topbar-user">{username ?? "User"}</p>
        </div>
        <button className="btn ghost" onClick={onLogout}>
          Logout
        </button>
      </section>
      <div className="tabs-shell">
        <Tabs />
      </div>
    </>
  );
}