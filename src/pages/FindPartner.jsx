import React, { useState } from 'react'
import axios from 'axios'
import API from '../lib/api'
import { useNavigate } from 'react-router-dom'

export default function FindPartner(){
  const [desired, setDesired] = useState('')
  const [partner, setPartner] = useState(null)
  const [matchId, setMatchId] = useState(null)
  const nav = useNavigate()

  const find = async () => {
    try{
  const skills = desired.split(',').map(s=>s.trim()).filter(Boolean)
  const res = await API.post('/api/match/find', { desiredSkills: skills })
      if (res.data.matchId) {
        setMatchId(res.data.matchId)
        setPartner(res.data.partner)
      } else {
        setPartner(null)
        alert('No matches found')
      }
    }catch(err){ console.error(err); alert('Error finding partner') }
  }

  const connect = async () => {
    try{
  const res = await API.post('/api/match/connect', { matchId })
  const room = await API.post('/api/video/start', { matchId })
      // pass matchId along so the VideoCall page can mark completion
      nav('/video/' + room.data.roomId, { state: { partner: res.data.partner, matchId } })
    }catch(err){ console.error(err); alert('Error connecting') }
  }

  return (
    <div className="max-w-2xl mx-auto bg-white p-6 rounded shadow">
      <h2 className="text-xl font-bold mb-4">Find a partner</h2>
      <label>Skills you want to learn (comma separated)</label>
      <input value={desired} onChange={e=>setDesired(e.target.value)} className="w-full p-2 border mb-2" />
      <button onClick={find} className="bg-blue-600 text-white px-4 py-2 rounded">Find</button>

      {partner && (
        <div className="mt-4 p-4 border rounded">
          <div><strong>{partner.name}</strong></div>
          <div>Skills: {partner.skills?.join(', ')}</div>
          <div>Phone: {partner.phoneNumber}</div>
          <button onClick={connect} className="mt-2 bg-green-600 text-white px-3 py-1 rounded">Start Video Call</button>
        </div>
      )}
    </div>
  )
}
