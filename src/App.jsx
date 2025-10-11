import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Signup from './pages/Signup'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import FindPartner from './pages/FindPartner'
import VideoCall from './pages/VideoCall'
import Home from './pages/Home'
import ProtectedRoute from './components/ProtectedRoute'
import Navbar from './components/Navbar'
import DashboardLayout from './pages/DashboardLayout'
import DashboardProfile from './pages/DashboardProfile'
import DashboardMain from './pages/DashboardMain'
import DashboardSwaps from './pages/DashboardSwaps'

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="p-4">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
            <Route index element={<DashboardMain />} />
            <Route path="profile" element={<DashboardProfile />} />
            <Route path="swaps" element={<DashboardSwaps />} />
          </Route>
          <Route path="/find" element={<ProtectedRoute><FindPartner /></ProtectedRoute>} />
          <Route path="/video/:roomId" element={<ProtectedRoute><VideoCall /></ProtectedRoute>} />
        </Routes>
      </main>
    </div>
  )
}
