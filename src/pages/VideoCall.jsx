import React, { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import API from '../lib/api';
import { io } from 'socket.io-client';

export default function VideoCall() {
  const { roomId } = useParams();
  const loc = useLocation();
  const navigate = useNavigate();

  const searchParams = new URLSearchParams(loc.search);
  const qsMatchId = searchParams.get('matchId');
  const qsPartnerName = searchParams.get('partnerName');
  const qsIsCaller = searchParams.get('isCaller');

  const [callState, setCallState] = useState({
    matchId: loc.state?.matchId || qsMatchId,
    partner: loc.state?.partner || (qsPartnerName ? { name: qsPartnerName } : { name: 'Partner' }),
    isCaller: loc.state?.isCaller || (qsIsCaller === 'true')
  });

  const localRef = useRef();
  const remoteRef = useRef();
  const pcRef = useRef();
  const socketRef = useRef();
  const localStreamRef = useRef();
  const connectionTimeoutRef = useRef();
  const retryCountRef = useRef(0);
  const pendingRemoteCandidatesRef = useRef([]);

  const [status, setStatus] = useState('Initializing...');
  const [rating, setRating] = useState(5);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [duration, setDuration] = useState('00:00');
  const [mediaError, setMediaError] = useState('');
  const [partnerName, setPartnerName] = useState(callState.partner?.name || 'Partner');

  const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'https://skillswap-backend-w0b7.onrender.com';

  // Get valid user ID
  const getValidUserId = () => {
    let userId = localStorage.getItem('userId');
    
    if (!userId || userId === 'undefined' || userId === 'null') {
      const userData = localStorage.getItem('user');
      if (userData) {
        try {
          const user = JSON.parse(userData);
          if (user && user._id) {
            localStorage.setItem('userId', user._id);
            return user._id;
          }
        } catch (e) {}
      }
      const tempUserId = 'user-' + Date.now();
      localStorage.setItem('userId', tempUserId);
      return tempUserId;
    }
    
    return userId;
  };

  // Initialize media
  const initializeMedia = async () => {
    try {
      setStatus('Getting camera and microphone...');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      
      localStreamRef.current = stream;
      
      if (localRef.current) {
        localRef.current.srcObject = stream;
        localRef.current.play().catch(console.error);
      }
      
      setStatus('Media ready');
      return stream;
      
    } catch (error) {
      console.error('Media error:', error);
      setMediaError(`Camera/microphone access denied: ${error.message}`);
      setStatus('Media Error');
      throw error;
    }
  };

  // Initialize WebRTC - SIMPLIFIED AND FIXED
  const initializeWebRTC = async (stream) => {
    try {
      setStatus('Setting up connection...');

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
        ]
      });

      pcRef.current = pc;

      // Add local tracks
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // Handle incoming remote stream - FIXED
      pc.ontrack = (event) => {
        console.log('✅ Received remote stream');
        const remoteStream = event.streams[0];
        
        if (remoteRef.current && remoteStream) {
          remoteRef.current.srcObject = remoteStream;
          remoteRef.current.onloadedmetadata = () => {
            remoteRef.current.play().catch(console.error);
          };
          setStatus('Connected ✅');
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current?.connected) {
          socketRef.current.emit('webrtc-signal', {
            roomId,
            type: 'candidate',
            candidate: event.candidate
          });
        }
      };

      // Connection state handling
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log('Connection state:', state);
        
        if (state === 'connected') {
          setStatus('Connected ✅');
          clearTimeout(connectionTimeoutRef.current);
        } else if (state === 'failed') {
          setStatus('Connection failed');
          handleReconnect();
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log('ICE state:', pc.iceConnectionState);
      };

      return pc;

    } catch (error) {
      console.error('WebRTC error:', error);
      setStatus('WebRTC Error');
      throw error;
    }
  };

  // Initialize Socket
  const initializeSocket = () => {
    return new Promise((resolve, reject) => {
      const socket = io(SOCKET_URL, {
        withCredentials: true,
        transports: ['websocket', 'polling']
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('✅ Socket connected');
        
        const userId = getValidUserId();
        const userData = localStorage.getItem('user');
        const userName = userData ? JSON.parse(userData).name : 'User';
        
        socket.emit('register-user', { userId, userName });
        socket.emit('join-room', { roomId, userId, userName });
        
        resolve(socket);
      });

      socket.on('connect_error', (error) => {
        console.error('Socket error:', error);
        setStatus('Connection failed');
        reject(error);
      });

      // Room events
      socket.on('joined-room', (data) => {
        console.log('✅ Joined room:', data);
        setStatus(data.isCaller ? 'Ready to call...' : 'Waiting for call...');
        
        if (data.isCaller) {
          // Caller creates offer after a delay
          setTimeout(() => createOffer(), 2000);
        }
      });

      socket.on('partner-joined', (data) => {
        console.log('👤 Partner joined:', data);
        setPartnerName(data.userName || 'Partner');
        setStatus('Partner joined - Connecting...');
        
        if (callState.isCaller) {
          setTimeout(() => createOffer(), 1000);
        }
      });

      // WebRTC signaling - FIXED
      socket.on('webrtc-signal', async (data) => {
        console.log('📡 Received signal:', data.type);
        
        if (!pcRef.current) return;

        try {
          if (data.type === 'offer') {
            console.log('📥 Processing offer...');
            setStatus('Connecting...');
            
            await pcRef.current.setRemoteDescription(data.offer);
            const answer = await pcRef.current.createAnswer();
            await pcRef.current.setLocalDescription(answer);
            
            socket.emit('webrtc-signal', {
              roomId,
              type: 'answer',
              answer: pcRef.current.localDescription
            });

            // Drain any queued ICE candidates
            if (pendingRemoteCandidatesRef.current.length > 0) {
              for (const c of pendingRemoteCandidatesRef.current) {
                try { await pcRef.current.addIceCandidate(c); } catch (e) { console.error(e); }
              }
              pendingRemoteCandidatesRef.current = [];
            }
            
          } else if (data.type === 'answer') {
            console.log('📥 Processing answer...');
            await pcRef.current.setRemoteDescription(data.answer);

            // Drain any queued ICE candidates
            if (pendingRemoteCandidatesRef.current.length > 0) {
              for (const c of pendingRemoteCandidatesRef.current) {
                try { await pcRef.current.addIceCandidate(c); } catch (e) { console.error(e); }
              }
              pendingRemoteCandidatesRef.current = [];
            }
            
          } else if (data.type === 'candidate') {
            // If remote description not set yet, buffer
            if (!pcRef.current.remoteDescription) {
              pendingRemoteCandidatesRef.current.push(data.candidate);
            } else {
              await pcRef.current.addIceCandidate(data.candidate);
            }
          }
        } catch (error) {
          console.error('Signal error:', error);
        }
      });

      // User info
      socket.on('user-info', (data) => {
        console.log('👤 User info:', data);
        if (data.userName && data.userName !== 'User') {
          setPartnerName(data.userName);
        }
      });

      socket.on('offer-requested', () => {
        if (callState.isCaller) {
          createOffer();
        }
      });
    });
  };

  // Create offer
  const createOffer = async () => {
    if (!pcRef.current) return;
    
    try {
      console.log('🎯 Creating offer...');
      setStatus('Starting call...');
      
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      
      socketRef.current.emit('webrtc-signal', {
        roomId,
        type: 'offer',
        offer: pcRef.current.localDescription
      });
      
      setStatus('Call started - Waiting for answer...');
      
    } catch (error) {
      console.error('Offer error:', error);
      setStatus('Failed to start call');
    }
  };

  // Handle reconnection
  const handleReconnect = () => {
    if (retryCountRef.current < 3) {
      retryCountRef.current++;
      setTimeout(() => {
        if (callState.isCaller) {
          createOffer();
        }
      }, 2000 * retryCountRef.current);
    }
  };

  // Manual reconnect
  const manualReconnect = () => {
    retryCountRef.current = 0;
    if (callState.isCaller) {
      createOffer();
    } else if (socketRef.current) {
      socketRef.current.emit('request-offer', { roomId });
      setStatus('Requesting call...');
    }
  };

  // Main useEffect
  useEffect(() => {
    let mounted = true;
    let timerInterval;

    const startCall = async () => {
      try {
        console.log('🚀 Starting video call...');
        
        // Get media stream
        const stream = await initializeMedia();
        if (!mounted) return;

        // Initialize WebRTC first so PC is ready before signaling
        await initializeWebRTC(stream);
        if (!mounted) return;

        // Initialize socket after PC exists to avoid race creating offers
        await initializeSocket();
        if (!mounted) return;

        // Start timer
        const startTime = Date.now();
        timerInterval = setInterval(() => {
          if (mounted) {
            const s = Math.floor((Date.now() - startTime) / 1000);
            const mm = String(Math.floor(s / 60)).padStart(2, '0');
            const ss = String(s % 60).padStart(2, '0');
            setDuration(`${mm}:${ss}`);
          }
        }, 1000);

        // Connection timeout
        connectionTimeoutRef.current = setTimeout(() => {
          if (mounted && !status.includes('Connected')) {
            console.log('⏰ Connection timeout');
            manualReconnect();
          }
        }, 10000);

      } catch (error) {
        if (mounted) {
          console.error('Call setup failed:', error);
          setStatus('Setup failed');
        }
      }
    };

    startCall();

    return () => {
      mounted = false;
      clearTimeout(connectionTimeoutRef.current);
      clearInterval(timerInterval);
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      if (pcRef.current) {
        pcRef.current.close();
      }
      
      if (socketRef.current) {
        try {
          const userId = localStorage.getItem('userId') || 'anonymous';
          socketRef.current.emit('leave-room', { roomId, userId });
        } catch (e) {}
        socketRef.current.disconnect();
      }
    };
  }, []);

  // Control functions
  const toggleMute = () => {
    if (localStreamRef.current) {
      const nextMuted = !muted;
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !nextMuted;
      });
      setMuted(nextMuted);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const nextVideoOff = !videoOff;
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = !nextVideoOff;
      });
      setVideoOff(nextVideoOff);
    }
  };

  const endCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (pcRef.current) pcRef.current.close();
    if (socketRef.current) {
      try {
        const userId = localStorage.getItem('userId') || 'anonymous';
        socketRef.current.emit('leave-room', { roomId, userId });
      } catch (e) {}
      socketRef.current.disconnect();
    }
    navigate('/dashboard');
  };

  return (
    <div className="space-y-4 p-4 max-w-4xl mx-auto">
      <h2 className="text-xl font-bold text-gray-800">Video Call</h2>

      <div className="p-4 bg-white rounded-lg shadow border">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-sm">
            <span className="font-medium">Partner:</span> {partnerName}
          </div>
          <div className="text-sm">
            <span className="font-medium">Role:</span> {callState.isCaller ? 'Caller' : 'Answerer'}
          </div>
          <div className="text-sm">
            <span className="font-medium">Status:</span> {status} • {duration}
          </div>
        </div>
        
        {mediaError && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
            <p className="text-red-700 text-sm">{mediaError}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-black rounded-lg overflow-hidden shadow-lg">
          <video 
            ref={localRef} 
            autoPlay 
            muted 
            playsInline
            className="w-full h-64 md:h-80 object-cover"
          />
          <div className="bg-gray-800 text-white text-center p-2 text-sm">
            You {muted && '🔇'} {videoOff && '📷❌'}
          </div>
        </div>
        <div className="bg-black rounded-lg overflow-hidden shadow-lg">
          <video 
            ref={remoteRef} 
            autoPlay 
            playsInline
            className="w-full h-64 md:h-80 object-cover bg-gray-900"
          />
          <div className="bg-gray-800 text-white text-center p-2 text-sm">
            {partnerName} {status === 'Connected ✅' && '🔊'}
            {!remoteRef.current?.srcObject && ' (Connecting...)'}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 justify-center">
        <button 
          className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
            muted ? 'bg-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`} 
          onClick={toggleMute}
        >
          {muted ? '🔇 Unmute' : '🔊 Mute'}
        </button>
        <button 
          className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
            videoOff ? 'bg-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`} 
          onClick={toggleVideo}
        >
          {videoOff ? '📷 Show Video' : '📷 Hide Video'}
        </button>
        <button 
          className="px-4 py-2 rounded-lg bg-yellow-600 text-white hover:bg-yellow-700 flex items-center gap-2" 
          onClick={manualReconnect}
        >
          🔄 Reconnect
        </button>
        <button 
          className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 flex items-center gap-2" 
          onClick={endCall}
        >
          📞 End Call
        </button>
      </div>

      <div className="mt-6 p-4 bg-white rounded-lg shadow border">
        <label className="block text-sm font-medium mb-2 text-gray-700">
          Rate your partner (1-5 stars)
        </label>
        <input 
          type="range" 
          min="1" 
          max="5" 
          value={rating} 
          onChange={e => setRating(Number(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
        <div className="mt-2 text-center">
          <span className="text-lg font-semibold">{rating}</span>
          <span className="ml-2 text-yellow-500">
            {'⭐'.repeat(rating)}
          </span>
        </div>
        <button 
          className="mt-3 w-full bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 font-medium" 
          onClick={endCall}
        >
          ✅ End Call & Rate
        </button>
      </div>
    </div>
  );
}