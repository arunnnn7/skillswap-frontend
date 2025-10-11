import React from 'react'
import { useOutletContext } from 'react-router-dom'

export default function DashboardProfile(){
  const { user } = useOutletContext() || {}

  return (
    <div className="max-w-3xl">
      <div className="bg-white p-6 rounded-xl shadow">
        <h3 className="text-lg font-semibold mb-4">My Profile</h3>
        {user ? (
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600">Full name</label>
              <div className="p-3 border rounded bg-gray-50">{user.name}</div>
            </div>
            <div>
              <label className="block text-sm text-gray-600">Email address</label>
              <div className="p-3 border rounded bg-gray-50">{user.email}</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-500">Loading profile...</div>
        )}
      </div>
    </div>
  )
}
