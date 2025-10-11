import React, { useEffect, useState } from 'react'
import API from '../lib/api'

export default function DashboardSwaps(){
  const [loading, setLoading] = useState(true)
  const [swaps, setSwaps] = useState([])

  useEffect(()=>{
    async function load(){
      setLoading(true)
      try{
        const res = await API.get('/api/match/my')
        setSwaps(res.data.matches || [])
      }catch(err){ console.error(err); setSwaps([]) }
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="p-6 bg-white rounded-xl shadow">Loading swaps...</div>

  if (!swaps.length) return (
    <div className="p-6 bg-white rounded-xl shadow">
      <h3 className="text-lg font-semibold mb-2">My Swaps</h3>
      <p className="text-sm text-gray-600">No active swaps yet</p>
    </div>
  )

  return (
    <div className="p-6 bg-white rounded-xl shadow">
      <h3 className="text-lg font-semibold mb-4">Completed Swaps</h3>
      <ul className="space-y-3">
        {swaps.map(s => (
          <li key={s.id} className="p-3 border rounded flex items-center justify-between">
            <div>
              <div className="font-semibold">Skill: {s.skill.join ? s.skill.join(', ') : s.skill}</div>
              <div className="text-sm text-gray-500">Partner: {s.partnerName} • {new Date(s.date).toLocaleString()}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
