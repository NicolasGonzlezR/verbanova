"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Tabs() {
  const pathname = usePathname();

  return (
    <>
      <style>{`
        .tabs-container {
          display: flex;
          gap: 6px;
          padding: 4px;
          background: #f1f5f9;
          border-radius: 12px;
          width: fit-content;
        }
        .tab {
          padding: 8px 18px;
          border-radius: 9px;
          text-decoration: none;
          font-size: 0.88rem;
          font-weight: 500;
          color: #64748b;
          transition: background 0.15s, color 0.15s, box-shadow 0.15s;
          white-space: nowrap;
        }
        .tab:hover {
          background: #ffffff;
          color: #0f172a;
        }
        .tab.active {
          background: #ffffff;
          color: #0f172a;
          font-weight: 600;
          box-shadow: 0 1px 4px rgba(15,23,42,0.1);
        }
      `}</style>
      <div className="tabs-container">
        <Link href="/translate" className={`tab ${pathname === "/translate" ? "active" : ""}`}>
          Translation
        </Link>
        <Link href="/subtitle" className={`tab ${pathname === "/subtitle" ? "active" : ""}`}>
          Subtitles
        </Link>
        <Link href="/voice-cloning" className={`tab ${pathname === "/voice-cloning" ? "active" : ""}`}>
          Voice Cloning
        </Link>
      </div>
    </>
  );
}
