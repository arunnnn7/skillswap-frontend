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
  const timerRef = useRef();
  const startedAtRef = useRef();
  const localStreamRef = useRef();
  const connectionTimeoutRef = useRef();

  const [status, setStatus] = useState('Initializing...');
  const [rating, setRating] = useState(5);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [duration, setDuration] = useState('00:00');
  const [mediaError, setMediaError] = useState('');

  const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'https://skillswap-backend-w0b7.onrender.com';

  // HTTPS check
  useEffect(() => {
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
      console.warn('Video calling requires HTTPS for media permissions');
    }
  }, []);

  // Initialize media
  const initializeMedia = async () => {
    try {
      setStatus('Requesting camera and microphone...');
      setMediaError('');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      localStreamRef.current = stream;
      
      if (localRef.current) {
        localRef.current.srcObject = stream;
        localRef.current.play().catch(e => console.error('Play error:', e));
      }
      
      setStatus('Media ready');
      return stream;
      
    } catch (error) {
      console.error('Media access error:', error);
      let errorMessage = 'Could not access camera/microphone. ';
      
      if (error.name === 'NotAllowedError') {
        errorMessage += 'Please allow camera and microphone permissions.';
      } else if (error.name === 'NotFoundError') {
        errorMessage += 'No camera or microphone found.';
      } else {
        errorMessage += `Error: ${error.message}`;
      }
      
      setMediaError(errorMessage);
      setStatus('Media Error');
      throw error;
    }
  };

  // Initialize WebRTC - FIXED VERSION
  const initializeWebRTC = async (stream) => {
    try {
      setStatus('Setting up WebRTC...');

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10
      });

      pcRef.current = pc;

      // Add local tracks with error handling
      stream.getTracks().forEach(track => {
        console.log('Adding local track:', track.kind, track.id);
        try {
          pc.addTrack(track, stream);
        } catch (addError) {
          console.error('Error adding track:', addError);
        }
      });

      // Handle remote stream - IMPROVED
      pc.ontrack = (event) => {
        console.log('✅ Received remote stream with tracks:', event.streams[0]?.getTracks().length);
        console.log('Remote tracks:', event.streams[0]?.getTracks().map(t => t.kind));
        
        if (remoteRef.current && event.streams[0]) {
          remoteRef.current.srcObject = event.streams[0];
          remoteRef.current.onloadedmetadata = () => {
            remoteRef.current.play().catch(e => console.error('Remote play error:', e));
          };
          setStatus('Connected ✅');
        }
      };

      // Handle ICE candidates - IMPROVED
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current?.connected) {
          console.log('📤 Sending ICE candidate');
          socketRef.current.emit('webrtc-signal', {
            roomId,
            type: 'candidate',
            candidate: event.candidate
          });
        } else if (!event.candidate) {
          console.log('✅ All ICE candidates gathered');
        }
      };

      // Better connection monitoring
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log('Connection state:', state);
        setStatus(state.charAt(0).toUpperCase() + state.slice(1));
        
        if (state === 'connected') {
          console.log('🎉 WebRTC fully connected!');
          clearTimeout(connectionTimeoutRef.current);
        } else if (state === 'failed') {
          console.log('❌ WebRTC connection failed');
          setStatus('Connection failed - try refreshing');
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', pc.iceConnectionState);
      };

      // Handle negotiation needed - FOR CALLER
      pc.onnegotiationneeded = async () => {
        console.log('🔄 Negotiation needed');
        if (callState.isCaller) {
          setTimeout(() => createOffer(), 1000);
        }
      };

      return pc;

    } catch (error) {
      console.error('WebRTC initialization error:', error);
      setStatus('WebRTC Error');
      throw error;
    }
  };

  // Initialize Socket
  const initializeSocket = () => {
    return new Promise((resolve, reject) => {
      try {
        const socket = io(SOCKET_URL, {
          withCredentials: true,
          transports: ['websocket', 'polling']
        });

        socketRef.current = socket;

        socket.on('connect', () => {
          console.log('✅ Socket connected:', socket.id);
          console.log('Backend URL:', SOCKET_URL);
          
          // Register user
          const userId = localStorage.getItem('userId');
          if (userId) {
            socket.emit('register-user', { userId });
            console.log('✅ User registered:', userId);
          }
          
          // Join room
          socket.emit('join-room', { 
            roomId, 
            userId: userId || 'anonymous'
          });
          console.log('✅ Joined room:', roomId);
          
          resolve(socket);
        });

        socket.on('connect_error', (error) => {
          console.error('❌ Socket connection error:', error);
          setStatus('Connection failed');
          reject(error);
        });

        // WebRTC Signaling - IMPROVED VERSION
        socket.on('webrtc-signal', async (data) => {
          console.log('📡 Received WebRTC signal:', data.type);
          
          if (!pcRef.current) {
            console.log('❌ No peer connection yet');
            return;
          }

          try {
            if (data.type === 'offer') {
              console.log('📥 Processing offer...');
              
              // Set remote description first
              await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.offer));
              console.log('✅ Remote description set (offer)');
              
              // Create and set local answer
              const answer = await pcRef.current.createAnswer();
              await pcRef.current.setLocalDescription(answer);
              console.log('✅ Answer created and set');
              
              // Send answer back
              socket.emit('webrtc-signal', {
                roomId,
                type: 'answer',
                answer: pcRef.current.localDescription
              });
              console.log('📤 Answer sent back to caller');
              
            } else if (data.type === 'answer') {
              console.log('📥 Processing answer...');
              
              // Set remote description for answer
              await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
              console.log('✅ Remote description set (answer)');
              
            } else if (data.type === 'candidate') {
              console.log('📥 Processing ICE candidate...');
              
              // Add ICE candidate with error handling
              try {
                if (data.candidate) {
                  await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
                  console.log('✅ ICE candidate added successfully');
                }
              } catch (iceError) {
                console.warn('⚠️ Failed to add ICE candidate (usually not critical):', iceError);
              }
            }
          } catch (error) {
            console.error('❌ Error handling signal:', error);
          }
        });

        // Legacy signal handler
        socket.on('signal', async (data) => {
          console.log('📡 Received legacy signal');
          if (!pcRef.current) return;

          try {
            if (data.sdp) {
              await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
              if (data.sdp.type === 'offer') {
                const answer = await pcRef.current.createAnswer();
                await pcRef.current.setLocalDescription(answer);
                socket.emit('signal', { roomId, data: { sdp: pcRef.current.localDescription } });
              }
            }
            if (data.candidate) {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
          } catch (error) {
            console.error('Error handling legacy signal:', error);
          }
        });

        // Room events
        socket.on('user-joined', (data) => {
          console.log('👤 User joined room:', data);
          setStatus('Partner joined');
        });

        socket.on('user-left', (data) => {
          console.log('👤 User left room:', data);
          setStatus('Partner disconnected');
        });

        socket.on('joined-room', (data) => {
          console.log('✅ Successfully joined room');
        });

      } catch (error) {
        reject(error);
      }
    });
  };

  // Create offer (for caller) - IMPROVED
  const createOffer = async () => {
    if (!pcRef.current) {
      console.log('❌ No peer connection for offer');
      return;
    }
    
    try {
      console.log('🎯 Creating offer as caller...');
      
      // Create offer with better options
      const offer = await pcRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      console.log('✅ Offer created, setting local description...');
      await pcRef.current.setLocalDescription(offer);
      console.log('✅ Local description set');
      
      // Send offer to other peer
      if (socketRef.current?.connected) {
        socketRef.current.emit('webrtc-signal', {
          roomId,
          type: 'offer',
          offer: pcRef.current.localDescription
        });
        console.log('📤 Offer sent to answerer');
      } else {
        console.log('❌ Socket not connected, cannot send offer');
      }
      
    } catch (error) {
      console.error('❌ Error creating offer:', error);
      // Retry after delay
      setTimeout(() => {
        if (pcRef.current) createOffer();
      }, 2000);
    }
  };

  // Main useEffect
  useEffect(() => {
    let mounted = true;

    const startCall = async () => {
      try {
        if (!mounted) return;

        console.log('🚀 Starting call process...');
        console.log('Role:', callState.isCaller ? 'Caller' : 'Answerer');
        console.log('Room ID:', roomId);

        // 1. Initialize media
        const stream = await initializeMedia();
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        // 2. Initialize socket
        await initializeSocket();
        if (!mounted) return;

        // 3. Initialize WebRTC
        await initializeWebRTC(stream);
        if (!mounted) return;

        // 4. Create offer if caller
        if (callState.isCaller) {
          console.log('⏳ Waiting to create offer...');
          // Give time for everything to initialize
          setTimeout(() => {
            if (mounted && pcRef.current) {
              createOffer();
            }
          }, 3000);
        } else {
          console.log('🎯 Waiting for offer as answerer...');
          setStatus('Waiting for offer...');
        }

        // Set connection timeout
        connectionTimeoutRef.current = setTimeout(() => {
          if (mounted && !status.includes('Connected')) {
            console.log('🕒 Connection timeout, retrying...');
            if (callState.isCaller && pcRef.current) {
              createOffer();
            }
          }
        }, 15000);

        // Start timer
        startedAtRef.current = Date.now();
        timerRef.current = setInterval(() => {
          if (mounted && startedAtRef.current) {
            const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
            const mm = String(Math.floor(s / 60)).padStart(2, '0');
            const ss = String(s % 60).padStart(2, '0');
            setDuration(`${mm}:${ss}`);
          }
        }, 1000);

      } catch (error) {
        if (mounted) {
          console.error('❌ Failed to start call:', error);
          setStatus(`Error: ${error.message}`);
        }
      }
    };

    startCall();

    return () => {
      mounted = false;
      console.log('🧹 Cleaning up call...');
      
      clearTimeout(connectionTimeoutRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      if (pcRef.current) {
        pcRef.current.close();
      }
      
      if (socketRef.current) {
        socketRef.current.emit('leave-room', { roomId });
        socketRef.current.disconnect();
      }
    };
  }, [roomId, SOCKET_URL, callState.isCaller]);

  // Control functions
  const toggleMute = () => {
    if (!localStreamRef.current) return;
    const newMuted = !muted;
    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = newMuted;
    });
    setMuted(newMuted);
  };

  const toggleVideo = () => {
    if (!localStreamRef.current) return;
    const newVideoOff = !videoOff;
    localStreamRef.current.getVideoTracks().forEach(track => {
      track.enabled = newVideoOff;
    });
    setVideoOff(newVideoOff);
  };

  const endCall = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    clearTimeout(connectionTimeoutRef.current);
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    if (socketRef.current) {
      socketRef.current.emit('leave-room', { roomId });
      socketRef.current.disconnect();
    }
    
    if (pcRef.current) pcRef.current.close();

    const matchId = callState.matchId;
    if (matchId) {
      try { 
        await API.post('/api/match/complete', { matchId, rating }); 
      } catch(e) {
        console.error('Error completing match:', e);
      }
    }
    
    navigate('/dashboard');
  };

  const retryMedia = async () => {
    setMediaError('');
    setStatus('Retrying media...');
    
    try {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      const stream = await initializeMedia();
      if (stream && pcRef.current) {
        const senders = pcRef.current.getSenders();
        for (const sender of senders) {
          if (sender.track) {
            if (sender.track.kind === 'audio') {
              const audioTrack = stream.getAudioTracks()[0];
              if (audioTrack) await sender.replaceTrack(audioTrack);
            } else if (sender.track.kind === 'video') {
              const videoTrack = stream.getVideoTracks()[0];
              if (videoTrack) await sender.replaceTrack(videoTrack);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to retry media:', error);
    }
  };

  const markCompleted = async () => {
    try {
      const matchId = callState.matchId;
      if (!matchId) {
        alert('No match id available');
        return;
      }
      
      await API.post('/api/match/complete', { matchId, rating });
      navigate('/dashboard/swaps');
    } catch (err) {
      console.error(err);
      alert('Error marking complete');
    }
  };

  return (
    <div className="space-y-4 p-4 max-w-4xl mx-auto">
      <h2 className="text-xl font-bold text-gray-800">Video Call</h2>

      {/* Debug info */}
      <div className="p-2 bg-blue-50 text-xs text-blue-800 rounded">
        <strong>Debug Info:</strong> Room: {roomId} | Backend: {SOCKET_URL} | 
        Local Tracks: {localRef.current?.srcObject?.getTracks().length || 0} | 
        Remote Tracks: {remoteRef.current?.srcObject?.getTracks().length || 0}
      </div>

      <div className="p-4 bg-white rounded-lg shadow border">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-sm">
            <span className="font-medium">Partner:</span> {callState.partner?.name}
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
            <button 
              onClick={retryMedia}
              className="mt-2 px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
            >
              Retry Camera & Microphone
            </button>
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
            className="w-full h-64 md:h-80 object-cover"
          />
          <div className="bg-gray-800 text-white text-center p-2 text-sm">
            {callState.partner?.name} {status === 'Connected' && '🔊'}
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
            {Array.from({length: rating}, (_, i) => '⭐').join('')}
          </span>
        </div>
        <button 
          className="mt-3 w-full bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 font-medium" 
          onClick={markCompleted}
        >
          ✅ Mark Swap Completed
        </button>
      </div>
    </div>
  );
}