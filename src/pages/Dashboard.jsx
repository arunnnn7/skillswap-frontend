import React, { useEffect, useState } from 'react'
import API from '../lib/api'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import PartnerCard from '../components/PartnerCard'
import { useToast } from '../components/Toast'

export default function Dashboard(){
  // keep the existing page but advise using nested routes: /dashboard/profile and /dashboard/swaps
  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <h3 className="text-lg font-semibold">Dashboard</h3>
        <p className="text-sm text-gray-500">Use the sidebar to navigate to My Profile or My Swaps.</p>
      </div>
    </div>
  )
}
