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
  const retryCountRef = useRef(0);
  const offerSentRef = useRef(false);

  const [status, setStatus] = useState('Initializing...');
  const [rating, setRating] = useState(5);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [duration, setDuration] = useState('00:00');
  const [mediaError, setMediaError] = useState('');
  const [debugInfo, setDebugInfo] = useState({
    signalingState: 'none',
    iceState: 'none',
    connectionState: 'none'
  });

  const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'https://skillswap-backend-w0b7.onrender.com';
  const MAX_RETRIES = 3;

  // HTTPS check
  useEffect(() => {
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
      console.warn('Video calling requires HTTPS for media permissions');
    }
  }, []);

  // Update debug info
  const updateDebugInfo = () => {
    if (pcRef.current) {
      setDebugInfo({
        signalingState: pcRef.current.signalingState,
        iceState: pcRef.current.iceConnectionState,
        connectionState: pcRef.current.connectionState
      });
    }
  };

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
      } else if (error.name === 'NotReadableError') {
        errorMessage += 'Camera/microphone is already in use by another application.';
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
          { urls: 'stun:stun2.l.google.com:19302' },
          // TURN servers for relay fallback
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all'
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

      // Handle remote stream - FIXED VERSION
      pc.ontrack = (event) => {
        console.log('✅ Received remote track:', event.track.kind, event.track.id);
        console.log('Remote streams:', event.streams);
        
        if (event.streams && event.streams[0]) {
          const remoteStream = event.streams[0];
          
          if (remoteRef.current) {
            remoteRef.current.srcObject = remoteStream;
            remoteRef.current.onloadedmetadata = () => {
              remoteRef.current.play().catch(e => {
                console.error('Remote video play error:', e);
              });
            };
            
            // Force play after a short delay
            setTimeout(() => {
              if (remoteRef.current && remoteRef.current.paused) {
                remoteRef.current.play().catch(console.error);
              }
            }, 1000);
          }
          
          setStatus('Connected ✅');
          clearTimeout(connectionTimeoutRef.current);
          retryCountRef.current = 0;
          console.log('🎉 WebRTC connection established!');
        }
      };

      // Handle ICE candidates - IMPROVED
      pc.onicecandidate = (event) => {
        updateDebugInfo();
        
        if (event.candidate) {
          console.log('📤 Sending ICE candidate:', event.candidate.type);
          // Small delay to ensure socket is ready
          setTimeout(() => {
            if (socketRef.current?.connected) {
              socketRef.current.emit('webrtc-signal', {
                roomId,
                type: 'candidate',
                candidate: event.candidate
              });
            }
          }, 100);
        } else {
          console.log('✅ All ICE candidates gathered');
        }
      };

      // ICE gathering state monitoring
      pc.onicegatheringstatechange = () => {
        console.log('ICE gathering state:', pc.iceGatheringState);
        updateDebugInfo();
      };

      // Signaling state monitoring
      pc.onsignalingstatechange = () => {
        console.log('Signaling state:', pc.signalingState);
        updateDebugInfo();
      };

      // ICE connection state monitoring
      pc.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', pc.iceConnectionState);
        updateDebugInfo();
        
        switch (pc.iceConnectionState) {
          case 'connected':
          case 'completed':
            setStatus('Connected ✅');
            clearTimeout(connectionTimeoutRef.current);
            break;
          case 'disconnected':
            setStatus('Disconnected - Reconnecting...');
            break;
          case 'failed':
            console.log('❌ ICE connection failed');
            setStatus('Connection failed - Retrying...');
            handleConnectionFailure();
            break;
        }
      };

      // Better connection state handling
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log('Connection state changed:', state);
        updateDebugInfo();
        
        switch (state) {
          case 'connected':
            setStatus('Connected ✅');
            clearTimeout(connectionTimeoutRef.current);
            retryCountRef.current = 0;
            break;
          case 'disconnected':
            setStatus('Disconnected - Reconnecting...');
            break;
          case 'failed':
            console.log('❌ Connection failed');
            setStatus('Connection failed - Retrying...');
            handleConnectionFailure();
            break;
          default:
            setStatus(state.charAt(0).toUpperCase() + state.slice(1));
        }
      };

      // Handle negotiation needed - FOR CALLER
      pc.onnegotiationneeded = async () => {
        console.log('🔄 Negotiation needed, caller:', callState.isCaller);
        updateDebugInfo();
        
        if (callState.isCaller && !offerSentRef.current) {
          // Wait a bit for everything to stabilize
          setTimeout(() => {
            if (pcRef.current && pcRef.current.signalingState === 'stable') {
              createOffer();
            }
          }, 2000);
        }
      };

      return pc;

    } catch (error) {
      console.error('WebRTC initialization error:', error);
      setStatus('WebRTC Error');
      throw error;
    }
  };

  // Handle connection failure
  const handleConnectionFailure = () => {
    if (retryCountRef.current < MAX_RETRIES) {
      retryCountRef.current++;
      console.log(`🔄 Retry attempt ${retryCountRef.current}/${MAX_RETRIES}`);
      
      setTimeout(() => {
        if (callState.isCaller && pcRef.current) {
          createOffer();
        } else if (!callState.isCaller) {
          // Answerer can request offer if it hasn't been received
          setStatus('Requesting offer...');
          if (socketRef.current) {
            socketRef.current.emit('request-offer', { roomId });
          }
        }
      }, 2000 * retryCountRef.current); // Exponential backoff
    } else {
      setStatus('Max retries exceeded - Please refresh');
    }
  };

  // Initialize Socket
  const initializeSocket = () => {
    return new Promise((resolve, reject) => {
      try {
        const socket = io(SOCKET_URL, {
          withCredentials: true,
          transports: ['websocket', 'polling'],
          timeout: 100000000
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
          setStatus('Connection failed - Retrying...');
          reject(error);
        });

        socket.on('disconnect', (reason) => {
          console.log('❌ Socket disconnected:', reason);
          setStatus('Disconnected - Reconnecting...');
        });

        // Room joined successfully
        socket.on('joined-room', (data) => {
          console.log('✅ Successfully joined room:', data);
          setStatus(callState.isCaller ? 'Ready to call...' : 'Waiting for offer...');
        });

        // Partner joined the room
        socket.on('partner-joined', (data) => {
          console.log('👤 Partner joined room:', data);
          if (callState.isCaller && !offerSentRef.current) {
            setStatus('Partner joined - Starting call...');
            // Give a moment then create offer
            setTimeout(() => createOffer(), 1000);
          }
        });

        // WebRTC Signaling - IMPROVED VERSION
        socket.on('webrtc-signal', async (data) => {
          console.log('📡 Received WebRTC signal:', data.type);
          updateDebugInfo();
          
          if (!pcRef.current) {
            console.log('❌ No peer connection yet');
            return;
          }

          try {
            if (data.type === 'offer') {
              console.log('📥 Processing offer...');
              setStatus('Received offer - Connecting...');
              
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
              setStatus('Received answer - Finalizing...');
              
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
            setStatus('Signal error - Retrying...');
          }
        });

        // Request for offer (answerer requesting offer from caller)
        socket.on('offer-requested', (data) => {
          console.log('📨 Offer requested by partner');
          if (callState.isCaller && pcRef.current && !offerSentRef.current) {
            setStatus('Partner requesting offer - Sending...');
            createOffer();
          }
        });

        // Incoming call notification
        socket.on('incoming-call', (data) => {
          console.log('📞 Incoming call received:', data);
          // Auto-join the call for now
          socket.emit('join-room', { roomId: data.roomId, userId: localStorage.getItem('userId') });
        });

        // Room events
        socket.on('user-joined', (data) => {
          console.log('👤 User joined room:', data);
          setStatus('Partner joined - Connecting...');
        });

        socket.on('user-left', (data) => {
          console.log('👤 User left room:', data);
          setStatus('Partner disconnected');
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
    
    if (offerSentRef.current) {
      console.log('⚠️ Offer already sent, skipping...');
      return;
    }
    
    try {
      console.log('🎯 Creating offer as caller...');
      setStatus('Creating offer...');
      offerSentRef.current = true;
      
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
        setStatus('Offer sent - Waiting for answer...');
      } else {
        console.log('❌ Socket not connected, cannot send offer');
        setStatus('Socket error - Retrying...');
        offerSentRef.current = false;
        setTimeout(() => createOffer(), 2000);
      }
      
    } catch (error) {
      console.error('❌ Error creating offer:', error);
      setStatus('Offer failed - Retrying...');
      offerSentRef.current = false;
      
      // Retry after delay with exponential backoff
      setTimeout(() => {
        if (pcRef.current && retryCountRef.current < MAX_RETRIES) {
          createOffer();
        }
      }, 3000);
    }
  };

  // Manual reconnection
  const manualReconnect = async () => {
    if (retryCountRef.current >= MAX_RETRIES) {
      retryCountRef.current = 0;
    }
    
    setStatus('Manual reconnection...');
    offerSentRef.current = false;
    
    if (callState.isCaller && pcRef.current) {
      await createOffer();
    } else if (!callState.isCaller && socketRef.current) {
      // Answerer can request offer
      socketRef.current.emit('request-offer', { roomId });
      setStatus('Requesting offer from partner...');
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

        // Set connection timeout
        connectionTimeoutRef.current = setTimeout(() => {
          if (mounted && !status.includes('Connected') && retryCountRef.current < MAX_RETRIES) {
            console.log('🕒 Connection timeout, retrying...');
            manualReconnect();
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
      track.enabled = !newMuted;
    });
    setMuted(newMuted);
  };

  const toggleVideo = () => {
    if (!localStreamRef.current) return;
    const newVideoOff = !videoOff;
    localStreamRef.current.getVideoTracks().forEach(track => {
      track.enabled = !newVideoOff;
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
      // Stop old tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      // Get new media stream
      const stream = await initializeMedia();
      localStreamRef.current = stream;
      
      // Update local video element
      if (localRef.current) {
        localRef.current.srcObject = stream;
      }
      
      // Replace tracks in peer connection
      if (pcRef.current) {
        const senders = pcRef.current.getSenders();
        
        // Replace audio track
        const audioTrack = stream.getAudioTracks()[0];
        const audioSender = senders.find(s => s.track?.kind === 'audio');
        if (audioSender && audioTrack) {
          await audioSender.replaceTrack(audioTrack);
        }
        
        // Replace video track  
        const videoTrack = stream.getVideoTracks()[0];
        const videoSender = senders.find(s => s.track?.kind === 'video');
        if (videoSender && videoTrack) {
          await videoSender.replaceTrack(videoTrack);
        }
      }
      
      setStatus('Media reconnected');
    } catch (error) {
      console.error('Failed to retry media:', error);
      setMediaError('Failed to reconnect media: ' + error.message);
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
        <strong>Debug Info:</strong> Room: {roomId} | 
        Role: {callState.isCaller ? 'Caller' : 'Answerer'} | 
        Signaling: {debugInfo.signalingState} | 
        ICE: {debugInfo.iceState} | 
        Connection: {debugInfo.connectionState} |
        Retries: {retryCountRef.current}/{MAX_RETRIES}
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
            className="w-full h-64 md:h-80 object-cover bg-gray-900"
          />
          <div className="bg-gray-800 text-white text-center p-2 text-sm">
            {callState.partner?.name} {status === 'Connected ✅' && '🔊'}
            {!remoteRef.current?.srcObject && ' (Waiting for video...)'}
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