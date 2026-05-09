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
          gap: 10px;
          margin-bottom: 20px;
          border-bottom: 1px solid #ccc;
          padding-bottom: 10px;
        }
        .tab {
          padding: 10px 20px;
          border-radius: 5px;
          text-decoration: none;
          background-color: #f0f0f0;
          color: black;
          transition: background-color 0.2s, transform 0.1s;
        }
        .tab:hover {
          background-color: #e0e0e0;
          transform: translateY(-2px);
        }
        .tab.active {
          background-color: #0070f3;
          color: white;
          font-weight: bold;
        }
      `}</style>
      <div className="tabs-container">
        <Link href="/translate" className={`tab ${pathname === "/translate" ? "active" : ""}`}>
          Translation
        </Link>
        <Link href="/subtitle" className={`tab ${pathname === "/subtitle" ? "active" : ""}`}>
          Subtitles
        </Link>
        <Link
          href="/voice-cloning"
          className={`tab ${pathname === "/voice-cloning" ? "active" : ""}`}
        >
          Voice Cloning
        </Link>
      </div>
    </>
  );
}