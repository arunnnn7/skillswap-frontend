import React from 'react'

export default function Topbar({ user }){
  return (
    <div className="flex items-center justify-between p-4 bg-white rounded-xl shadow-sm">
      <div className="flex items-center gap-4">
        <input placeholder="Search skills, people..." className="px-3 py-2 rounded-md border w-80 text-sm" />
        <div className="text-sm text-gray-600">Welcome back, <span className="font-semibold text-navy">{user?.name || 'User'}</span></div>
      </div>
      <div className="flex items-center gap-3">
        <button className="relative px-3 py-2 rounded-md bg-white shadow">
          🔔
          <span className="absolute -top-1 -right-1 bg-coral text-white text-xs px-1 rounded-full">3</span>
        </button>
        <div className="w-9 h-9 rounded-full bg-gray-300 flex items-center justify-center">{user?.name?.[0] || 'U'}</div>
      </div>
    </div>
  )
}
