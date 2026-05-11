"use client";

import Image from "next/image";
import Tabs from "@/components/Tabs";

type AppHeaderProps = {
  username?: string | null;
  onLogout: () => void;
};

export default function AppHeader({ username, onLogout }: AppHeaderProps) {
  return (
    <>
      <section className="topbar">
        <Image src="/logo.svg" alt="VerbaNova" width={160} height={36} priority />
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginLeft: "auto" }}>
          <div>
            <p className="topbar-label">Signed in</p>
            <p className="topbar-user">{username ?? "User"}</p>
          </div>
          <button className="btn ghost" onClick={onLogout}>
            Logout
          </button>
        </div>
      </section>
      <div className="tabs-shell">
        <Tabs />
      </div>
    </>
  );
}