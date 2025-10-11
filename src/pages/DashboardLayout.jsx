import React, { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import API from '../lib/api'

export default function DashboardLayout(){
  const [user, setUser] = useState(null)

  useEffect(()=>{
    API.get('/api/users/me').then(res=> setUser(res.data)).catch(()=>{})
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="md:pl-[340px] p-6">
        <Topbar user={user} />
        <div className="mt-4">
          <Outlet context={{ user }} />
        </div>
      </div>
    </div>
  )
}
