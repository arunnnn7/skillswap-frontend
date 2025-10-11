import React from 'react'
import { Link } from 'react-router-dom'

export default function Sidebar(){
  return (
    <aside className="w-64 bg-navy text-white rounded-xl p-4 shadow-md hidden md:block fixed top-24 left-6 h-[calc(100vh-96px)]">
      <div className="mb-6 text-lg font-semibold">SkillSwap</div>
      <nav className="flex flex-col gap-2">
        <Link to="/dashboard" className="px-3 py-2 rounded hover:bg-navy/80">My Dashboard</Link>
        <Link to="/dashboard/profile" className="px-3 py-2 rounded hover:bg-navy/80">My Profile</Link>
        <Link to="/dashboard/swaps" className="px-3 py-2 rounded hover:bg-navy/80">My Swaps</Link>
      </nav>
    </aside>
  )
}
