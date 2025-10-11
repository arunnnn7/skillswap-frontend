import React, { useState } from 'react'
import axios from 'axios'
import API from '../lib/api'
import { useNavigate, useLocation } from 'react-router-dom'
import { useToast } from '../components/Toast'

export default function Signup(){
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [msg, setMsg] = useState('')
  const loc = useLocation()
  const nav = useNavigate()
  const toast = useToast()

  React.useEffect(()=>{
    if (localStorage.getItem('token')) nav('/dashboard')
  }, [nav])

  const submit = async (e) => {
    e.preventDefault()
    try{
  const res = await API.post('/api/auth/signup', form)
  // auto-login: store token and redirect to dashboard
  localStorage.setItem('token', res.data.token)
  toast.show('Welcome! Redirecting to dashboard...', 'success')
  nav('/dashboard')
    }catch(err){
      setMsg(err.response?.data?.msg || 'Signup failed')
    }
  }

  React.useEffect(()=>{
    if (loc.state?.msg) setMsg(loc.state.msg)
  }, [loc])

  return (
    <div className="max-w-md mx-auto bg-white p-6 rounded shadow">
      <h2 className="text-xl font-bold mb-4">Sign up</h2>
      {msg && <div className="bg-red-100 p-2 text-red-700 mb-2">{msg}</div>}
      <form onSubmit={submit}>
        <input className="w-full p-2 border mb-2" placeholder="Name" value={form.name} onChange={e=>setForm({...form, name: e.target.value})} />
        <input className="w-full p-2 border mb-2" placeholder="Email" value={form.email} onChange={e=>setForm({...form, email: e.target.value})} />
        <input type="password" className="w-full p-2 border mb-2" placeholder="Password" value={form.password} onChange={e=>setForm({...form, password: e.target.value})} />
        <button className="bg-blue-600 text-white px-4 py-2 rounded">Create account</button>
      </form>
    </div>
  )
}
