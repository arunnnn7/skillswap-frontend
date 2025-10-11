
import React from 'react'
import { Navigate } from 'react-router-dom'

export default function ProtectedRoute({ children }){
  const token = localStorage.getItem('token')
  // If no token, redirect to public Home page
  if (!token) return <Navigate to="/" replace />
  return children
}
