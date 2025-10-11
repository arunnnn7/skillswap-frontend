import React, { useEffect, useState, useRef } from 'react'
import API from '../lib/api'
import { io } from 'socket.io-client'
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL

export default function DashboardMain(){
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  const [offeredForm, setOfferedForm] = useState({ skillName: '', category: '', proficiencyLevel: 'beginner', description: '' })
  const [wantedForm, setWantedForm] = useState({ skillName: '', category: '', priorityLevel: 'medium', description: '' })

  useEffect(()=>{
    async function load(){
      setLoading(true)
      try{
        const res = await API.get('/api/dashboard')
        const matchesRes = await API.get('/api/dashboard/matches')
        setData({ ...res.data, matches: matchesRes.data.matches })
      }catch(err){ console.error(err); setData(null) }
      setLoading(false)
    }
    load()
  }, [])

  // socket setup for incoming call notifications
  const socketRef = useRef()
  const [incomingCall, setIncomingCall] = useState(null)
  useEffect(()=>{
    if (!data?.user) return
    try{
      socketRef.current = io(SOCKET_URL)
      // register our user id so server can target us
      socketRef.current.emit('register-user', { userId: data.user._id })
      socketRef.current.on('incoming-call', (payload) => {
        // payload: { roomId, from, matchId }
        setIncomingCall(payload)
      })
    }catch(e){ console.error('socket init failed', e) }

    return ()=>{
      socketRef.current?.disconnect()
    }
  }, [data?.user])

  const addOffered = async ()=>{
    try{
      const res = await API.post('/api/skills/offered', offeredForm)
      setOfferedForm({ skillName: '', category: '', proficiencyLevel: 'beginner', description: '' })
      // refresh
      const d = await API.get('/api/dashboard')
      setData(d.data)
    }catch(err){ console.error(err); alert('Failed to add skill') }
  }

  const addWanted = async ()=>{
    try{
      await API.post('/api/skills/wanted', wantedForm)
      setWantedForm({ skillName: '', category: '', priorityLevel: 'medium', description: '' })
      const d = await API.get('/api/dashboard')
      setData(d.data)
    }catch(err){ console.error(err); alert('Failed to add wanted skill') }
  }

  const delSkill = async (id)=>{
    if (!confirm('Delete this skill?')) return
    // optimistic update
    const prev = data
    setData({...data, my_skills: { offered: data.my_skills.offered.filter(s=>s._id !== id), wanted: data.my_skills.wanted.filter(s=>s._id !== id) }})
    try{
      const res = await API.delete('/api/skills/' + id)
      if (!res.data.success) throw new Error(res.data.error || 'Delete failed')
    }catch(err){ console.error(err); alert('Failed to delete. Please try again.'); setData(prev) }
  }

  const handleConnect = async (match) => {
    // simple connection state machine with one retry for transient failures
    let attempts = 0
    while (attempts < 2) {
      attempts++
      try{
        const findRes = await API.post('/api/match/find', { desiredSkills: [match.skill] })
        // log for diagnostics
        console.log('match/find response', findRes.status, findRes.data)
        const matchId = findRes.data.matchId || findRes.data.match?._id
        if (!matchId) {
          const msg = findRes.data?.msg || JSON.stringify(findRes.data)
          return alert('Failed to create match for video call: ' + msg)
        }

        const roomRes = await API.post('/api/video/start', { matchId })
        console.log('video/start response', roomRes.status, roomRes.data)
        const roomId = roomRes.data.roomId
        if (!roomId) return alert('Failed to start video room: ' + JSON.stringify(roomRes.data))

        const partnerName = match.partner?.name || ''
        window.location.href = '/video/' + roomId + '?matchId=' + matchId + '&partnerName=' + encodeURIComponent(partnerName)
        return
      }catch(err){
        console.error('handleConnect attempt error', attempts, err)
        // surface server provided message when available
        const serverMsg = err?.response?.data || err?.message
        if (attempts >= 2) return alert('Failed to start video call: ' + JSON.stringify(serverMsg))
        // otherwise small backoff and retry
        await new Promise(r => setTimeout(r, 400 * attempts))
      }
    }
  }

  if (loading) return <div className="p-6 bg-white rounded-xl shadow">Loading dashboard...</div>

  if (!data) return <div className="p-6 bg-white rounded-xl shadow">Failed to load dashboard</div>

  return (
    <div className="space-y-6 max-w-5xl">
      {incomingCall && (
        <div className="fixed right-6 bottom-6 bg-white p-4 rounded-lg shadow-xl border w-80">
          <div className="font-semibold">Incoming Call</div>
          <div className="text-sm text-gray-600">From: {incomingCall.from?.name || 'Caller'}</div>
          <div className="mt-3 flex gap-2">
            <button className="px-3 py-1 bg-green-600 text-white rounded" onClick={()=>{
              const roomId = incomingCall.roomId
              const matchId = incomingCall.matchId
              const partnerName = incomingCall.from?.name || ''
              window.location.href = '/video/' + roomId + '?matchId=' + matchId + '&partnerName=' + encodeURIComponent(partnerName)
            }}>Join</button>
            <button className="px-3 py-1 bg-gray-200 rounded" onClick={()=>setIncomingCall(null)}>Ignore</button>
          </div>
        </div>
      )}
      <div className="bg-white p-6 rounded-xl shadow">
        <h2 className="text-xl font-semibold">Welcome back, {data.user?.name}!</h2>
        <div className="mt-3 flex gap-4">
          <div className="p-3 bg-gray-50 rounded">{data.stats.offered_skills} Skills Offered</div>
          <div className="p-3 bg-gray-50 rounded">{data.stats.wanted_skills} Skills Wanted</div>
          <div className="p-3 bg-gray-50 rounded">{data.stats.completed_swaps} Completed Swaps</div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow">
          <h3 className="font-semibold mb-3">Offer a Skill</h3>
          <label className="block text-sm">Skill name</label>
          <input className="w-full p-2 border mb-2" value={offeredForm.skillName} onChange={e=>setOfferedForm({...offeredForm, skillName: e.target.value})} />
          <label className="block text-sm">Category</label>
          <input className="w-full p-2 border mb-2" value={offeredForm.category} onChange={e=>setOfferedForm({...offeredForm, category: e.target.value})} />
          <label className="block text-sm">Proficiency</label>
          <select className="w-full p-2 border mb-2" value={offeredForm.proficiencyLevel} onChange={e=>setOfferedForm({...offeredForm, proficiencyLevel: e.target.value})}>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
          <label className="block text-sm">Description (optional)</label>
          <textarea className="w-full p-2 border mb-2" value={offeredForm.description} onChange={e=>setOfferedForm({...offeredForm, description: e.target.value})} />
          <button className="bg-coral text-white px-4 py-2 rounded" onClick={addOffered}>Add Skill</button>
        </div>

        <div className="bg-white p-6 rounded-xl shadow">
          <h3 className="font-semibold mb-3">Want to Learn</h3>
          <label className="block text-sm">Skill name</label>
          <input className="w-full p-2 border mb-2" value={wantedForm.skillName} onChange={e=>setWantedForm({...wantedForm, skillName: e.target.value})} />
          <label className="block text-sm">Category</label>
          <input className="w-full p-2 border mb-2" value={wantedForm.category} onChange={e=>setWantedForm({...wantedForm, category: e.target.value})} />
          <label className="block text-sm">Priority</label>
          <select className="w-full p-2 border mb-2" value={wantedForm.priorityLevel} onChange={e=>setWantedForm({...wantedForm, priorityLevel: e.target.value})}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <label className="block text-sm">Description (optional)</label>
          <textarea className="w-full p-2 border mb-2" value={wantedForm.description} onChange={e=>setWantedForm({...wantedForm, description: e.target.value})} />
          <button className="bg-coral text-white px-4 py-2 rounded" onClick={addWanted}>Add Skill</button>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow">
        <h3 className="font-semibold mb-3">My Offered Skills</h3>
        <ul className="space-y-2">
          {data.my_skills.offered.map(s => (
            <li key={s._id} className="flex justify-between items-center p-2 border rounded">
              <div>
                <div className="font-semibold">{s.skillName}</div>
                <div className="text-sm text-gray-500">{s.category} • {s.proficiencyLevel}</div>
              </div>
              <button className="text-sm text-red-500" onClick={()=>delSkill(s._id)}>Delete</button>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white p-6 rounded-xl shadow">
        <h3 className="font-semibold mb-3">Potential Matches</h3>
        <ul className="space-y-3">
          {(data.matches?.offeredMatches || []).map((m, idx) => (
            <li key={'o'+idx} className="p-3 border rounded flex items-center justify-between">
              <div>
                <div className="font-semibold">{m.skill}</div>
                <div className="text-sm text-gray-500">Type: You offer ↔ {m.partner.name} wants</div>
                <div className="text-sm text-gray-500">Match Score: {m.score}%</div>
              </div>
              <button className="bg-indigo-600 text-white px-3 py-1 rounded" onClick={()=>handleConnect(m)}>Connect</button>
            </li>
          ))}
          {(data.matches?.wantedMatches || []).map((m, idx) => (
            <li key={'w'+idx} className="p-3 border rounded flex items-center justify-between">
              <div>
                <div className="font-semibold">{m.skill}</div>
                <div className="text-sm text-gray-500">Type: You want ↔ {m.partner.name} offers</div>
                <div className="text-sm text-gray-500">Match Score: {m.score}%</div>
              </div>
              <button className="bg-indigo-600 text-white px-3 py-1 rounded" onClick={()=>handleConnect(m)}>Connect</button>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white p-6 rounded-xl shadow">
        <h3 className="font-semibold mb-3">My Wanted Skills</h3>
        <ul className="space-y-2">
          {data.my_skills.wanted.map(s => (
            <li key={s._id} className="flex justify-between items-center p-2 border rounded">
              <div>
                <div className="font-semibold">{s.skillName}</div>
                <div className="text-sm text-gray-500">{s.category} • {s.priorityLevel}</div>
              </div>
              <button className="text-sm text-red-500" onClick={()=>delSkill(s._id)}>Delete</button>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white p-6 rounded-xl shadow">
        <h3 className="font-semibold mb-3">Browse Available Skills</h3>
        <div className="grid md:grid-cols-3 gap-4">
          {data.browse_skills.offered.map(s => (
            <div key={s._id} className="p-3 border rounded">
              <div className="font-semibold">{s.skillName}</div>
              <div className="text-sm text-gray-500">Owner: {s.user?.name}</div>
              <div className="mt-2"><button className="bg-indigo-600 text-white px-3 py-1 rounded">Request Swap</button></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
