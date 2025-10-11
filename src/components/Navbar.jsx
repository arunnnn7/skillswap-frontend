import React from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function Navbar() {
  const nav = useNavigate()
  const logged = !!localStorage.getItem('token')

  const logout = () => {
    localStorage.removeItem('token')
    nav('/')
  }

  return (
    <nav className="bg-white/60 backdrop-blur-md sticky top-0 z-30 shadow-sm">
      <div className="max-w-6xl mx-auto px-6 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold">SS</div>
          <div className="text-lg font-semibold text-gray-800">Skill Swap</div>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/" className="text-gray-700 hover:text-indigo-600 transition">Home</Link>
          <button onClick={()=>{
            // If already on home, set hash to trigger scroll; otherwise navigate with state
            if (window.location.pathname === '/') {
              const el = document.getElementById('how-it-works')
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              else window.location.hash = '#how'
            } else {
              // navigate to home with a query param so Home can scroll on mount
              window.location.href = '/#how'
            }
          }} className="text-gray-700 hover:text-indigo-600 transition hidden md:inline">How It Works</button>
          {logged ? (
            <>
              <button onClick={logout} className="text-sm text-red-500 hover:underline">Logout</button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-gray-700 hover:text-indigo-600 transition">Login</Link>
              <Link to="/signup" className="px-4 py-2 rounded-md bg-coral text-white hover:bg-opacity-90 transition">Sign Up Free</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
