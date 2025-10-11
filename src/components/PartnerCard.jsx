import React from 'react'

export default function PartnerCard({ partner, onConnect }){
  return (
    <div className="bg-white rounded-xl p-4 shadow hover:shadow-lg transition transform hover:-translate-y-1">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-lg font-bold">{partner.name?.[0] || 'P'}</div>
        <div className="flex-1">
          <div className="font-semibold">{partner.name}</div>
          <div className="text-sm text-gray-500">Skills: {partner.skills?.join(', ')}</div>
          <div className="text-sm text-gray-500">Wants: {partner.wants?.join(', ')}</div>
        </div>
        <div>
          <button onClick={()=>onConnect(partner)} className="px-3 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition">Connect</button>
        </div>
      </div>
    </div>
  )
}
