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
  const qsCallerName = searchParams.get('callerName');

  // Enhanced call state with partner and caller info
  const [callState, setCallState] = useState({
    matchId: loc.state?.matchId || qsMatchId,
    partner: loc.state?.partner || (qsPartnerName ? { name: qsPartnerName } : { name: 'Loading...' }),
    caller: loc.state?.caller || (qsCallerName ? { name: qsCallerName } : { name: 'Loading...' }),
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

  // Helper function to get valid user ID
  const getValidUserId = () => {
    let userId = localStorage.getItem('userId');
    
    if (!userId || userId === 'undefined' || userId === 'null' || userId === 'anonymous') {
      console.warn('Invalid user ID from localStorage:', userId);
      
      const userData = localStorage.getItem('user');
      if (userData) {
        try {
          const user = JSON.parse(userData);
          if (user && user._id) {
            console.log('✅ Found valid user ID from user object:', user._id);
            localStorage.setItem('userId', user._id);
            return user._id;
          }
        } catch (e) {
          console.error('Failed to parse user data:', e);
        }
      }
      
      const tempUserId = 'user-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      console.log('🔄 Generated temporary user ID:', tempUserId);
      localStorage.setItem('userId', tempUserId);
      return tempUserId;
    }
    
    console.log('✅ Using valid user ID:', userId);
    return userId;
  };

  // Fetch call details including partner information
  const fetchCallDetails = async () => {
    try {
      const matchId = callState.matchId;
      if (!matchId) {
        console.log('No match ID available');
        return;
      }

      if (callState.isCaller) {
        // Caller already has partner info from /start endpoint
        console.log('Caller - Partner:', callState.partner?.name);
      } else {
        // Answerer needs to fetch partner/caller info
        console.log('Answerer - Fetching call details...');
        const response = await API.post('/api/video/join', {
          roomId,
          matchId
        });
        
        if (response.data.success) {
          setCallState(prev => ({
            ...prev,
            partner: response.data.caller, // For answerer, partner is the caller
            caller: response.data.caller
          }));
          console.log('✅ Answerer - Loaded partner info:', response.data.caller.name);
        }
      }
    } catch (error) {
      console.error('Error fetching call details:', error);
    }
  };

  // Debug user ID at component start
  useEffect(() => {
    const userId = getValidUserId();
    console.log('🔍 Current User ID:', userId);
    console.log('🔍 Room ID:', roomId);
    console.log('🔍 Call State:', callState);
    
    // Fetch call details on component mount
    fetchCallDetails();
  }, []);

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

  // Initialize WebRTC
  const initializeWebRTC = async (stream) => {
    try {
      setStatus('Setting up WebRTC...');

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
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
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all'
      });

      pcRef.current = pc;

      // Add local tracks
      stream.getTracks().forEach(track => {
        console.log('Adding local track:', track.kind, track.id);
        try {
          pc.addTrack(track, stream);
        } catch (addError) {
          console.error('Error adding track:', addError);
        }
      });

      // Handle remote stream
      pc.ontrack = (event) => {
        console.log('✅ Received remote track:', event.track.kind, event.track.id);
        
        if (event.streams && event.streams[0]) {
          const remoteStream = event.streams[0];
          
          if (remoteRef.current) {
            remoteRef.current.srcObject = remoteStream;
            remoteRef.current.onloadedmetadata = () => {
              remoteRef.current.play().catch(e => {
                console.error('Remote video play error:', e);
              });
            };
            
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

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        updateDebugInfo();
        
        if (event.candidate) {
          console.log('📤 Sending ICE candidate');
          setTimeout(() => {
            if (socketRef.current?.connected) {
              socketRef.current.emit('webrtc-signal', {
                roomId,
                type: 'candidate',
                candidate: event.candidate
              });
            }
          }, 100);
        }
      };

      // Connection state monitoring
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
          case 'failed':
            console.log('❌ Connection failed');
            setStatus('Connection failed - Retrying...');
            handleConnectionFailure();
            break;
          default:
            setStatus(state.charAt(0).toUpperCase() + state.slice(1));
        }
      };

      // Handle negotiation needed
      pc.onnegotiationneeded = async () => {
        console.log('🔄 Negotiation needed, caller:', callState.isCaller);
        updateDebugInfo();
        
        if (callState.isCaller && !offerSentRef.current) {
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
          setStatus('Requesting offer...');
          if (socketRef.current) {
            socketRef.current.emit('request-offer', { roomId });
          }
        }
      }, 2000 * retryCountRef.current);
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
          timeout: 10000
        });

        socketRef.current = socket;

        socket.on('connect', () => {
          console.log('✅ Socket connected:', socket.id);
          
          const userId = getValidUserId();
          if (userId) {
            socket.emit('register-user', { userId });
            console.log('✅ User registered with ID:', userId);
            
            socket.emit('join-room', { 
              roomId, 
              userId: userId
            });
            console.log('✅ Joined room:', roomId, 'with user:', userId);
          } else {
            console.error('❌ No valid user ID available');
            setStatus('Error: User authentication failed');
            reject(new Error('No valid user ID'));
            return;
          }
          
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
          const userId = getValidUserId();
          console.log('👤 Current user ID:', userId, 'Users in room:', data.usersInRoom);
          setStatus(callState.isCaller ? 'Ready to call...' : 'Waiting for offer...');
        });

        // Partner joined the room
        socket.on('partner-joined', (data) => {
          console.log('👤 Partner joined room:', data);
          if (callState.isCaller && !offerSentRef.current) {
            setStatus('Partner joined - Starting call...');
            setTimeout(() => createOffer(), 1000);
          }
        });

        // WebRTC Signaling
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
              
              await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.offer));
              console.log('✅ Remote description set (offer)');
              
              const answer = await pcRef.current.createAnswer();
              await pcRef.current.setLocalDescription(answer);
              console.log('✅ Answer created and set');
              
              socket.emit('webrtc-signal', {
                roomId,
                type: 'answer',
                answer: pcRef.current.localDescription
              });
              console.log('📤 Answer sent back to caller');
              
            } else if (data.type === 'answer') {
              console.log('📥 Processing answer...');
              setStatus('Received answer - Finalizing...');
              
              await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
              console.log('✅ Remote description set (answer)');
              
            } else if (data.type === 'candidate') {
              console.log('📥 Processing ICE candidate...');
              
              try {
                if (data.candidate) {
                  await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
                  console.log('✅ ICE candidate added successfully');
                }
              } catch (iceError) {
                console.warn('⚠️ Failed to add ICE candidate:', iceError);
              }
            }
          } catch (error) {
            console.error('❌ Error handling signal:', error);
            setStatus('Signal error - Retrying...');
          }
        });

        // Request for offer
        socket.on('offer-requested', (data) => {
          console.log('📨 Offer requested by partner');
          if (callState.isCaller && pcRef.current && !offerSentRef.current) {
            setStatus('Partner requesting offer - Sending...');
            createOffer();
          }
        });

        // User info exchange - NEW EVENT
        socket.on('user-info', (data) => {
          console.log('👤 Received user info:', data);
          if (data.userId !== getValidUserId()) {
            setCallState(prev => ({
              ...prev,
              partner: {
                name: data.userName || 'Partner',
                id: data.userId
              }
            }));
            console.log('✅ Updated partner info:', data.userName);
          }
        });

        // Share user info with partner
        socket.on('user-joined', (data) => {
          console.log('👤 User joined room:', data);
          setStatus('Partner joined - Connecting...');
          
          // Share our user info with the new user
          const userId = getValidUserId();
          const userData = localStorage.getItem('user');
          let userName = 'You';
          
          if (userData) {
            try {
              const user = JSON.parse(userData);
              userName = user.name || 'You';
            } catch (e) {
              console.error('Error parsing user data:', e);
            }
          }
          
          socket.emit('share-user-info', {
            roomId,
            userId: userId,
            userName: userName
          });
        });

        socket.on('user-left', (data) => {
          console.log('👤 User left room:', data);
          setStatus('Partner disconnected');
        });

        socket.on('join-error', (data) => {
          console.error('❌ Failed to join room:', data.error);
          setStatus('Error: Failed to join call');
        });

      } catch (error) {
        reject(error);
      }
    });
  };

  // Create offer
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
      
      const offer = await pcRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      console.log('✅ Offer created, setting local description...');
      await pcRef.current.setLocalDescription(offer);
      console.log('✅ Local description set');
      
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
      socketRef.current.emit('request-offer', { roomId });
      setStatus('Requesting offer from partner...');
    }
  };

  // Main useEffect
  useEffect(() => {
    let mounted = true;

    const userId = getValidUserId();
    if (!userId) {
      setStatus('Error: Please log in first');
      setTimeout(() => navigate('/login'), 2000);
      return;
    }

    const startCall = async () => {
      try {
        if (!mounted) return;

        console.log('🚀 Starting call process...');
        console.log('Role:', callState.isCaller ? 'Caller' : 'Answerer');
        console.log('Room ID:', roomId);
        console.log('User ID:', userId);
        console.log('Partner:', callState.partner?.name);

        const stream = await initializeMedia();
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        await initializeSocket();
        if (!mounted) return;

        await initializeWebRTC(stream);
        if (!mounted) return;

        connectionTimeoutRef.current = setTimeout(() => {
          if (mounted && !status.includes('Connected') && retryCountRef.current < MAX_RETRIES) {
            console.log('🕒 Connection timeout, retrying...');
            manualReconnect();
          }
        }, 15000);

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
        const userId = getValidUserId();
        socketRef.current.emit('leave-room', { roomId, userId });
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
      const userId = getValidUserId();
      socketRef.current.emit('leave-room', { roomId, userId });
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
      localStreamRef.current = stream;
      
      if (localRef.current) {
        localRef.current.srcObject = stream;
      }
      
      if (pcRef.current) {
        const senders = pcRef.current.getSenders();
        
        const audioTrack = stream.getAudioTracks()[0];
        const audioSender = senders.find(s => s.track?.kind === 'audio');
        if (audioSender && audioTrack) {
          await audioSender.replaceTrack(audioTrack);
        }
        
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

  // Get display name for partner
  const getPartnerDisplayName = () => {
    if (callState.partner?.name && callState.partner.name !== 'Loading...') {
      return callState.partner.name;
    }
    return callState.isCaller ? 'Partner' : 'Caller';
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
            <span className="font-medium">Partner:</span> {getPartnerDisplayName()}
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
            {getPartnerDisplayName()} {status === 'Connected ✅' && '🔊'}
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