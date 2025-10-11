import React, { useEffect, useRef, useState } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import API from '../lib/api'
import { io } from 'socket.io-client'

// Compute socket URL safely for deployed environment
let SOCKET_URL = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || ''
if (!SOCKET_URL) {
  SOCKET_URL = typeof window !== 'undefined' ? window.location.origin : ''
}
if (SOCKET_URL && typeof window !== 'undefined' && window.location.protocol === 'https:'){
  SOCKET_URL = SOCKET_URL.replace(/^http:\/\//i, 'https://').replace(/^ws:\/\//i, 'wss://')
}

export default function VideoCall(){
  const { roomId } = useParams()
  const loc = useLocation()
  // If navigated via window.location.href, attempt to read query params for fallback
  const searchParams = new URLSearchParams(loc.search)
  const qsMatchId = searchParams.get('matchId')
  const qsPartnerName = searchParams.get('partnerName')
  if (!loc.state) loc.state = {}
  if (!loc.state.matchId && qsMatchId) loc.state.matchId = qsMatchId
  if (!loc.state.partner && qsPartnerName) loc.state.partner = { name: qsPartnerName }
  const localRef = useRef()
  const remoteRef = useRef()
  const pcRef = useRef()
  const socketRef = useRef()
  const [status, setStatus] = useState('Initializing')
  const [rating, setRating] = useState(5)
  const [muted, setMuted] = useState(false)
  const [videoOff, setVideoOff] = useState(false)
  const [startedAt, setStartedAt] = useState(null)
  const [duration, setDuration] = useState('00:00')
  const timerRef = useRef()
  const startedAtRef = useRef()

  useEffect(()=>{
    async function init(){
      try{
        setStatus('Connecting...')
        socketRef.current = io(SOCKET_URL)
        socketRef.current.emit('join-room', { roomId, userId: 'me' })

        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        localRef.current.srcObject = stream

        const pc = new RTCPeerConnection()
        pcRef.current = pc

        stream.getTracks().forEach(track => pc.addTrack(track, stream))

        pc.ontrack = (e) => {
          remoteRef.current.srcObject = e.streams[0]
        }

        pc.onicecandidate = (e) => {
          if (e.candidate) socketRef.current.emit('signal', { roomId, data: { candidate: e.candidate } })
        }

        socketRef.current.on('signal', async (data) => {
          if (data.sdp) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
            if (data.sdp.type === 'offer') {
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              socketRef.current.emit('signal', { roomId, data: { sdp: pc.localDescription } })
            }
          }
          if (data.candidate) {
            try { await pc.addIceCandidate(data.candidate) } catch (err) { console.error(err) }
          }
        })

        // create offer if first in room
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        socketRef.current.emit('signal', { roomId, data: { sdp: pc.localDescription } })

        // mark connected once remote stream arrives or after offer
        setStatus('Connected')
        const now = Date.now()
        setStartedAt(now)
        startedAtRef.current = now
        timerRef.current = setInterval(()=>{
          const s = Math.floor((Date.now() - (startedAtRef.current || Date.now()))/1000)
          const mm = String(Math.floor(s/60)).padStart(2,'0')
          const ss = String(s%60).padStart(2,'0')
          setDuration(`${mm}:${ss}`)
        }, 1000)
      }catch(err){ console.error(err); setStatus('Error') }
    }

    init()

    return () => {
      clearInterval(timerRef.current)
      // stop local tracks
      try{ localRef.current?.srcObject && localRef.current.srcObject.getTracks().forEach(t=>t.stop()) }catch(e){}
      socketRef.current?.disconnect()
      pcRef.current?.close()
    }
  }, [roomId])

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">Video Call</h2>

      <div className="p-3 bg-white rounded shadow">
        <div className="flex items-center justify-between">
          <div>Partner: {loc.state?.partner?.name || 'Partner'}</div>
          <div>Call status: {status} • {duration}</div>
        </div>
        {status === 'Connecting...' && <div className="mt-2 text-sm text-gray-600">Starting video call with {loc.state?.partner?.name || 'your partner'}...</div>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-black rounded overflow-hidden">
          <video ref={localRef} autoPlay muted className="w-full h-64 object-cover" />
        </div>
        <div className="bg-black rounded overflow-hidden">
          <video ref={remoteRef} autoPlay className="w-full h-64 object-cover" />
        </div>
      </div>

      <div className="flex gap-3">
        <button className={`px-3 py-2 rounded ${muted ? 'bg-gray-400' : 'bg-indigo-600 text-white'}`} onClick={()=>{
          setMuted(v=>!v)
          try{ const tracks = localRef.current?.srcObject?.getAudioTracks() || []; tracks.forEach(t=>t.enabled = muted) }catch(e){}
        }}>{muted ? 'Unmute' : 'Mute'}</button>

        <button className={`px-3 py-2 rounded ${videoOff ? 'bg-gray-400' : 'bg-indigo-600 text-white'}`} onClick={()=>{
          setVideoOff(v=>!v)
          try{ const tracks = localRef.current?.srcObject?.getVideoTracks() || []; tracks.forEach(t=>t.enabled = videoOff) }catch(e){}
        }}>{videoOff ? 'Turn Video On' : 'Turn Video Off'}</button>

        <button className="px-3 py-2 rounded bg-red-600 text-white" onClick={async ()=>{
          // end call: cleanup and navigate back
          clearInterval(timerRef.current)
          try{ localRef.current?.srcObject && localRef.current.srcObject.getTracks().forEach(t=>t.stop()) }catch(e){}
          socketRef.current?.emit('leave-room', { roomId })
          socketRef.current?.disconnect()
          pcRef.current?.close()
          // mark match complete if matchId provided
          const matchId = loc.state?.matchId
          if (matchId) {
            try{ await API.post('/api/match/complete', { matchId }) }catch(e){ }
          }
          window.location.href = '/dashboard'
        }}>End Call</button>
      </div>

      <div className="mt-4 p-4 bg-white rounded shadow">
        <label className="block text-sm font-medium mb-1">Rate your partner (1-5)</label>
        <input type="range" min="1" max="5" value={rating} onChange={e=>setRating(Number(e.target.value))} />
        <div className="mt-2">Selected: {rating}</div>
        <button className="mt-3 bg-indigo-600 text-white px-3 py-1 rounded" onClick={async ()=>{
          try{
            const matchId = loc.state?.matchId
            if (!matchId) return alert('No match id available')
            await API.post('/api/match/complete', { matchId, rating })
            // navigate back to dashboard swaps
            window.location.href = '/dashboard/swaps'
          }catch(err){ console.error(err); alert('Error marking complete') }
        }}>Mark Completed</button>
      </div>
    </div>
  )
}
